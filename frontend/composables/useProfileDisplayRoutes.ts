import { computed, ref, watch, type MaybeRef, toValue } from "vue";
import type { Profile, NodeRoute, RelayRoute } from "~/bindings/github.com/lagzap/zap/data";
import { RoutingMode } from "~/bindings/github.com/lagzap/zap/data";
import { ProfileFlag } from "~/constants/profile";
import type { Connection, RouteProbeSlotMetric } from "~/types/monitoring";
import {
  buildNodeLocationLabelMap,
  nodeCityGroupKey,
} from "~/composables/useNodeLocationLabel";
import { useNetworkAdapterSettings } from "~/composables/useNetworkAdapterSettings";
import {
  DEFAULT_TCP_ROUTES,
  DEFAULT_UDP_ROUTES,
} from "~/composables/routeCountUtils";
import { useProfileChartConnection } from "~/composables/useProfileViewInterface";

const ROUTE_VARIANTS = ["ipv4-udp", "ipv4-tcp", "ipv6-udp", "ipv6-tcp"] as const;
const MAX_ROUTE_SLOTS = 4;
/** Stick with the current top flow unless another pulls ahead on total usage. */
const TOP_CONN_USAGE_SWITCH_RATIO = 1.25;
const TOP_CONN_USAGE_SWITCH_BYTES = 256 * 1024;

/** Total bytes transferred — preferred rank for “top” game flow. */
export function connectionUsageBytes(connection: Connection) {
  return Math.abs(connection.download || 0) + Math.abs(connection.upload || 0);
}

function connectionSpeed(connection: Connection) {
  return (
    Math.abs(connection.download_speed || 0) +
    Math.abs(connection.upload_speed || 0)
  );
}

function connectionHasChartRelay(connection: Connection) {
  return !!(connection.relay_route?.tag || connection.node_id);
}

/**
 * Pick the profile connection that should drive the latency chart / route
 * diagram. Rank by total usage (bytes), not instantaneous speed — games often
 * hold two equal-rate flows; the heavier session is the one to chart.
 */
export function pickTopProfileConnection(
  profileId: string,
  connections: Connection[],
  previousId?: string | null
): Connection | null {
  const profileConnections = connections.filter(
    (connection) => connection.profile_id === profileId
  );
  if (profileConnections.length === 0) {
    return null;
  }

  const ranked = [...profileConnections].sort((a, b) => {
    const usageDelta = connectionUsageBytes(b) - connectionUsageBytes(a);
    if (usageDelta !== 0) {
      return usageDelta;
    }
    // Prefer a flow that can actually feed relay probes / chart series.
    const chartDelta =
      Number(connectionHasChartRelay(b)) - Number(connectionHasChartRelay(a));
    if (chartDelta !== 0) {
      return chartDelta;
    }
    const speedDelta = connectionSpeed(b) - connectionSpeed(a);
    if (speedDelta !== 0) {
      return speedDelta;
    }
    const latencyA = a.min_latency || a.avg_latency || Infinity;
    const latencyB = b.min_latency || b.avg_latency || Infinity;
    return latencyA - latencyB;
  });

  const best = ranked[0];
  if (!previousId || best.id === previousId) {
    return best;
  }

  const previous = profileConnections.find(
    (connection) => connection.id === previousId
  );
  if (!previous) {
    return best;
  }

  const bestUsage = connectionUsageBytes(best);
  const previousUsage = connectionUsageBytes(previous);
  const usageAhead =
    bestUsage >= previousUsage * TOP_CONN_USAGE_SWITCH_RATIO &&
    bestUsage >= previousUsage + TOP_CONN_USAGE_SWITCH_BYTES;
  if (usageAhead) {
    return best;
  }

  // Stick while the previous flow is still alive and chartable — avoids
  // wiping latency history when two peers trade the speed lead.
  if (connectionHasChartRelay(previous)) {
    return previous;
  }
  return best;
}

function resolveRelayRouteForNode(
  nodeId: string,
  routes: Record<string, RelayRoute>
): RelayRoute | null {
  for (const variant of ROUTE_VARIANTS) {
    const routeData = routes[`${nodeId}-${variant}`];
    if (
      routeData &&
      Array.isArray(routeData.routes) &&
      routeData.routes.length > 0
    ) {
      return routeData;
    }
  }
  return null;
}

function nodeMatchesSelection(node: any, profileState: any): boolean {
  const mode = profileState.mode;

  if (!mode || mode === RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL) {
    return true;
  }

  if (mode === RoutingMode.RoutingMode_ROUTING_MODE_REGIONAL) {
    const selectedRegions = profileState.regions || [];
    if (selectedRegions.length === 0) return true;
    return selectedRegions.includes(node.region);
  }

  if (mode === RoutingMode.RoutingMode_ROUTING_MODE_COUNTRY) {
    const selectedCountries = profileState.countries || [];
    if (selectedCountries.length === 0) return true;
    return selectedCountries.includes(node.country);
  }

  if (mode === RoutingMode.RoutingMode_ROUTING_MODE_CITY) {
    const selectedCities = profileState.cities || [];
    if (selectedCities.length === 0) return true;
    const nodeCityKey = nodeCityGroupKey(node);
    return selectedCities.some(
      (city) =>
        city === node.name ||
        city === node.id ||
        city.toLowerCase() === nodeCityKey
    );
  }

  if (mode === RoutingMode.RoutingMode_ROUTING_MODE_NODE) {
    const selectedNodeId = profileState.node_id;
    if (!selectedNodeId || selectedNodeId === "") return true;
    return node.name === selectedNodeId;
  }

  return false;
}

export function nodeRoutePathKey(route: NodeRoute): string {
  return (route.hops ?? []).map((hop) => hop.ip || "").join("->");
}

/** Path + transport — TCP and UDP are distinct slots even with the same hops. */
export function nodeRouteSlotKey(
  route: NodeRoute,
  network?: "tcp" | "udp"
): string {
  const transport =
    network ??
    (route.tcp_available && !route.udp_available
      ? "tcp"
      : route.udp_available && !route.tcp_available
        ? "udp"
        : route.udp_available
          ? "udp"
          : route.tcp_available
            ? "tcp"
            : "udp");
  return `${transport}|${nodeRoutePathKey(route)}`;
}

function tagRouteNetwork(route: NodeRoute, network: "tcp" | "udp"): NodeRoute {
  const cloned = cloneNodeRoute(route);
  if (network === "tcp") {
    cloned.tcp_available = true;
    cloned.udp_available = false;
  } else {
    cloned.tcp_available = false;
    cloned.udp_available = true;
  }
  return cloned;
}

function cloneNodeRoute(route: NodeRoute): NodeRoute {
  return {
    ...route,
    hops: (route.hops ?? []).map((hop) => ({ ...hop })),
  } as NodeRoute;
}

/** Update hop labels from measured E2E RTT.
 * Direct routes: the only hop IS the E2E RTT.
 * Multi-hop: keep measured legs — scaling to a lucky probe understates entry cities. */
export function syncRouteHopLatencies(route: NodeRoute, total: number): void {
  const hops = route.hops ?? [];
  if (!hops.length || !(total > 0)) {
    return;
  }
  if (hops.length === 1) {
    hops[0].latency = Math.round(total);
  }
}

/** Client→entry hop — strongest floor for “ping to this city”. */
export function routeHopFloorMs(route: NodeRoute | null | undefined): number {
  if (!route) {
    return 0;
  }
  const hops = route.hops ?? [];
  const hop0 = hops[0]?.latency || 0;
  // Prefer the largest measured hop leg — entry cities (~100ms) beat exit stubs (0–7ms).
  let bestHop = hop0;
  for (const hop of hops) {
    const ms = hop.latency || 0;
    if (ms > bestHop) {
      bestHop = ms;
    }
  }
  if (bestHop > 0) {
    return bestHop;
  }
  return route.avg_latency || route.min_latency || 0;
}

/**
 * Live probes must not undercut the measured hop floor.
 * A 20ms stamp on a ~100ms Frankfurt hop is what made Estimated Ping lie.
 */
export function isPlausibleProbeForRoute(
  latency: number,
  route: NodeRoute | null | undefined,
  floorOverride?: number
): boolean {
  if (!(latency > 0) || latency >= 500) {
    return false;
  }
  const floor =
    floorOverride != null && floorOverride > 0
      ? floorOverride
      : routeHopFloorMs(route);
  if (floor >= 40 && latency < Math.max(20, floor * 0.5)) {
    return false;
  }
  return true;
}

/** Apply one interface's probe RTT onto a cloned route — never another NIC's data. */
export function applyIfaceProbeToRoute(
  route: NodeRoute,
  probe: { latency?: number; packet_loss?: number; jitter?: number; score?: number } | null | undefined,
  topologyFloorMs?: number
): NodeRoute {
  const cloned = cloneNodeRoute(route);
  const floor = topologyFloorMs && topologyFloorMs > 0
    ? topologyFloorMs
    : routeHopFloorMs(cloned);
  const latency = probe?.latency ?? 0;
  const loss = probe?.packet_loss ?? 0;

  // Always surface loss from this probe round (including 100% timeouts).
  if (loss > 0) {
    cloned.packet_loss = loss;
  } else if (probe && !(latency > 0)) {
    cloned.packet_loss = 100;
  }

  // Ignore failed / roof-spike / impossibly-fast probes for RTT — keep hop floor.
  if (!isPlausibleProbeForRoute(latency, cloned, floor)) {
    return cloned;
  }

  cloned.avg_latency = latency;
  cloned.min_latency = Math.round(latency);
  if (!cloned.max_latency || cloned.max_latency < latency) {
    cloned.max_latency = Math.round(latency);
  }
  if (probe?.jitter != null) {
    cloned.jitter = probe.jitter;
  }
  if (probe?.score != null && probe.score > 0) {
    cloned.score = probe.score;
  }
  // Multi-hop: keep topology legs (98ms Frankfurt). Only direct routes sync the hop.
  if ((cloned.hops?.length ?? 0) <= 1) {
    syncRouteHopLatencies(cloned, latency);
  }
  return cloned;
}

/** End-to-end RTT to the relay — never report below the client→entry hop floor. */
export function routeRelayLatency(route: NodeRoute | null | undefined): number {
  if (!route) {
    return 0;
  }

  const floor = routeHopFloorMs(route);
  const measured = route.avg_latency || route.min_latency || 0;
  const clampToFloor = (ms: number) => {
    if (!(ms > 0)) {
      return floor > 0 ? Math.round(floor) : 0;
    }
    if (floor >= 40) {
      return Math.round(Math.max(ms, floor * 0.85));
    }
    return Math.round(ms);
  };

  if (measured > 0 && isPlausibleProbeForRoute(measured, route, floor)) {
    return clampToFloor(measured);
  }

  const hops = route.hops ?? [];
  if (hops.length === 0) {
    return floor > 0 ? Math.round(floor) : 0;
  }
  if (hops.length === 1) {
    return clampToFloor(hops[0]?.latency || floor || 0);
  }

  const hopSum = hops.reduce((sum, hop) => sum + (hop.latency || 0), 0);
  if (floor > 0) {
    return clampToFloor(hopSum > 0 ? hopSum : floor);
  }
  const lastHop = hops[hops.length - 1]?.latency || 0;
  if (lastHop > 0 && hopSum > 0 && lastHop >= hopSum * 0.5) {
    return Math.round(lastHop);
  }
  return hopSum > 0 ? Math.round(hopSum) : 0;
}

/** Per-hop leg labels for the route diagram — measured legs, not E2E-scaled shares. */
export function routeHopLegLatencies(route: NodeRoute): number[] {
  const hops = route.hops ?? [];
  if (hops.length === 0) {
    return [];
  }

  if (hops.length === 1) {
    const measured = route.avg_latency || route.min_latency || 0;
    if (measured > 0) {
      return [Math.round(measured)];
    }
  }

  return hops.map((hop) => Math.round(hop.latency || 0));
}

/** Tooltip/chart-friendly metrics aligned with hop path to relay. */
export function routeRelayMetrics(route: NodeRoute | null | undefined) {
  const estimated = routeRelayLatency(route);
  const probeMin = route?.min_latency || 0;
  const probeAvg = route?.avg_latency || 0;
  const probeMax = route?.max_latency || 0;

  if (estimated <= 0) {
    return {
      estimated: probeMin || probeAvg,
      min: probeMin || probeAvg,
      avg: probeAvg || probeMin,
      max: probeMax || probeAvg || probeMin,
      score: route?.score || 0,
    };
  }

  const min =
    probeMin > 0 && probeMin <= estimated * 1.25
      ? Math.min(probeMin, estimated)
      : estimated;
  const avg =
    probeAvg > 0 && probeAvg <= estimated * 1.5
      ? Math.max(probeAvg, min)
      : min;
  const max =
    probeMax > 0 && probeMax >= min
      ? Math.max(probeMax, avg)
      : Math.max(avg, estimated);

  return {
    estimated,
    min,
    avg,
    max,
    score: route?.score || 0,
  };
}

export function bestRouteRelayLatency(
  routes: NodeRoute[]
): { ping: number; score: number; loss: number; route: NodeRoute | null } {
  let best: { ping: number; score: number; loss: number; route: NodeRoute | null } = {
    ping: 0,
    score: 0,
    loss: 0,
    route: null,
  };

  for (const route of routes) {
    const metrics = routeRelayMetrics(route);
    const ping = metrics.estimated;
    if (ping <= 0) {
      continue;
    }
    if (best.ping === 0 || ping < best.ping) {
      best = {
        ping: Math.round(ping),
        score: metrics.score || 0,
        loss: route.packet_loss || 0,
        route,
      };
    }
  }

  return best;
}

export function pickBestInterfaceGroup<
  T extends { name: string; routes: NodeRoute[] },
>(groups: T[]): T | null {
  if (groups.length === 0) {
    return null;
  }
  let best = groups[0];
  let bestPing = 0;
  for (const group of groups) {
    const ping = bestRouteRelayLatency(group.routes).ping;
    if (ping <= 0) {
      continue;
    }
    if (bestPing === 0 || ping < bestPing) {
      best = group;
      bestPing = ping;
    }
  }
  return best;
}

type ConnectionRouteSource = {
  avg_latency?: number;
  min_latency?: number;
  max_latency?: number;
  relay_route?: {
    routes?: NodeRoute[] | null;
  } | null;
};

/** Best latency to relay for a live connection row. */
export function connectionRelayLatency(
  connection: ConnectionRouteSource | null | undefined
): number | null {
  if (!connection) {
    return null;
  }

  const routes = connection.relay_route?.routes;
  if (routes?.length) {
    const best = bestRouteRelayLatency(routes);
    if (best.ping > 0) {
      return Math.round(best.ping);
    }
  }

  const fallback = connection.min_latency || connection.avg_latency || 0;
  return fallback > 0 ? Math.round(fallback) : null;
}

export function connectionRelayScore(
  connection: ConnectionRouteSource | null | undefined
): number | null {
  const routes = connection.relay_route?.routes;
  if (!routes?.length) {
    return null;
  }

  const best = bestRouteRelayLatency(routes);
  return best.score > 0 ? best.score : null;
}

export function routeDisplayName(
  route: NodeRoute,
  nodes: Record<string, any>,
  localized: (value: any) => string
): string {
  const firstHop = route.hops?.[0];
  if (!firstHop?.ip) {
    return "Route";
  }

  const nodeList = Object.values(nodes);
  const hopNode = nodeList.find(
    (node) => node.ipv4 === firstHop.ip || node.ipv6 === firstHop.ip
  );

  if (hopNode) {
    const labelMap = buildNodeLocationLabelMap(nodeList, localized);
    return labelMap.get(hopNode.id) ?? (localized(hopNode.city) as string);
  }

  return firstHop.ip;
}

function findBestNodeId(
  matchingNodes: any[],
  routes: Record<string, RelayRoute>
): string | null {
  let bestNodeId: string | null = null;
  let lowestLatency = Infinity;

  for (const node of matchingNodes) {
    for (const variant of ROUTE_VARIANTS) {
      const routeData = routes[`${node.id}-${variant}`];
      if (
        !routeData ||
        !Array.isArray(routeData.routes) ||
        routeData.routes.length === 0
      ) {
        continue;
      }

      const firstRoute = routeData.routes[0];
      const latency = firstRoute?.min_latency;
      if (
        typeof latency === "number" &&
        !Number.isNaN(latency) &&
        latency > 0 &&
        latency < lowestLatency
      ) {
        lowestLatency = latency;
        bestNodeId = node.id;
      }
    }
  }

  return bestNodeId;
}

function relayRoutesForNode(
  routes: Record<string, RelayRoute>,
  nodeId: string,
  network: "tcp" | "udp"
): NodeRoute[] {
  const variants =
    network === "tcp"
      ? (["ipv4-tcp", "ipv6-tcp"] as const)
      : (["ipv4-udp", "ipv6-udp"] as const);

  const merged: NodeRoute[] = [];
  for (const suffix of variants) {
    const routeData = routes[`${nodeId}-${suffix}`];
    if (routeData?.routes?.length) {
      merged.push(...(routeData.routes as NodeRoute[]));
    }
  }
  return sortRoutesByLatency(merged);
}

function sortRoutesByLatency(routes: NodeRoute[]): NodeRoute[] {
  return [...routes].sort((a, b) => {
    const latencyA = a.min_latency || Infinity;
    const latencyB = b.min_latency || Infinity;
    return latencyA - latencyB;
  });
}

function dedupeRoutesByPathKey(routes: NodeRoute[]): NodeRoute[] {
  const out: NodeRoute[] = [];
  const seen = new Set<string>();

  for (const route of routes) {
    const key = nodeRoutePathKey(route);
    if (key) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }
    out.push(route);
  }

  return out;
}

/**
 * Take exactly `count` routes for a transport. Prefer unique hop paths first;
 * if the pool is smaller than count, reuse paths so the diagram matches the
 * configured TCP/UDP connection counts.
 */
function takeNetworkRoutes(
  pool: NodeRoute[],
  count: number,
  network: "tcp" | "udp",
  out: NodeRoute[]
) {
  if (count <= 0 || pool.length === 0) {
    return;
  }
  for (let i = 0; i < count; i++) {
    out.push(tagRouteNetwork(pool[i % pool.length], network));
  }
}

/**
 * Stamp configured TCP/UDP slot counts onto a path pool.
 * Live connection routes often keep both tcp_available+udp_available from the
 * optimizer; without this the diagram prefers TCP even when settings are UDP-only.
 */
export function expandRoutesForTransportCounts(
  pool: NodeRoute[],
  tcpCount: number,
  udpCount: number
): NodeRoute[] {
  const unique = dedupeRoutesByPathKey(sortRoutesByLatency(pool));
  if (unique.length === 0) {
    return [];
  }
  const out: NodeRoute[] = [];
  takeNetworkRoutes(unique, Math.max(0, tcpCount), "tcp", out);
  takeNetworkRoutes(unique, Math.max(0, udpCount), "udp", out);
  return out.slice(0, MAX_ROUTE_SLOTS);
}

export function buildMultipathRoutesFromPool(
  matchingNodes: any[],
  routes: Record<string, RelayRoute>,
  tcpCount: number,
  udpCount: number
): NodeRoute[] {
  const nodeId = findBestNodeId(matchingNodes, routes);
  if (!nodeId) {
    return [];
  }

  const tcpRoutes = dedupeRoutesByPathKey(
    relayRoutesForNode(routes, nodeId, "tcp")
  );
  const udpRoutes = dedupeRoutesByPathKey(
    relayRoutesForNode(routes, nodeId, "udp")
  );
  const out: NodeRoute[] = [];

  takeNetworkRoutes(tcpRoutes, tcpCount, "tcp", out);
  takeNetworkRoutes(udpRoutes, udpCount, "udp", out);

  // If one transport pool is empty, still fill the configured slots from the
  // other pool so 0 TCP / 2 UDP never falls back to unlabeled dual-capable paths.
  if (out.length === 0) {
    const fallback = tcpRoutes.length > 0 ? tcpRoutes : udpRoutes;
    return expandRoutesForTransportCounts(fallback, tcpCount, udpCount);
  }

  return out.slice(0, MAX_ROUTE_SLOTS);
}

function findBestRelayRoute(
  matchingNodes: any[],
  routes: Record<string, RelayRoute>
): RelayRoute | null {
  const nodeId = findBestNodeId(matchingNodes, routes);
  if (!nodeId) {
    return null;
  }

  for (const variant of ROUTE_VARIANTS) {
    const routeData = routes[`${nodeId}-${variant}`];
    if (routeData?.routes?.length) {
      return routeData;
    }
  }
  return null;
}

function routesFromRelayRoute(
  relayRoute: RelayRoute | null,
  limit: number
): NodeRoute[] {
  if (!relayRoute?.routes?.length || limit <= 0) {
    return [];
  }
  return dedupeRoutesByPathKey(
    sortRoutesByLatency(relayRoute.routes as NodeRoute[])
  ).slice(0, limit);
}

function collectConnectionRoutes(
  profileId: string,
  connections: Connection[],
  limit: number
): NodeRoute[] {
  const profileConnections = connections.filter(
    (connection) =>
      connection.profile_id === profileId &&
      connection.relay_route?.routes?.length
  );
  if (profileConnections.length === 0) {
    return [];
  }

  const merged: NodeRoute[] = [];
  const seen = new Set<string>();

  for (const connection of profileConnections) {
    const dialed =
      connection.network === "tcp" || connection.network === "udp"
        ? connection.network
        : null;
    for (const route of connection.relay_route!.routes!) {
      // Prefer the transport the connection actually dialed over optimizer
      // capability flags (both tcp+udp available → diagram used to say TCP).
      const stamped = dialed ? tagRouteNetwork(route, dialed) : route;
      const key = nodeRouteSlotKey(stamped, dialed ?? undefined);
      if (key) {
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
      }
      merged.push(stamped);
    }
  }

  return sortRoutesByLatency(merged).slice(0, limit);
}

export function useProfileDisplayRoutes(profile: MaybeRef<Profile>) {
  const store = useStore();
  const { connections, routeProbeHistory } = useMonitoringStore();
  const { getNodeLabelByIp } = useNodeLocationLabel();
  const {
    resolvedGlobalTcp,
    resolvedGlobalUdp,
    ensureLoaded: ensureNetworkSettingsLoaded,
  } = useNetworkAdapterSettings();
  void ensureNetworkSettingsLoaded();

  const profileRef = computed(() => toValue(profile));
  const profileState = computed(
    () => store.profileStates[profileRef.value?.id ?? ""] ?? null
  );

  /** Profile override, else network-adapter settings defaults. */
  const resolvedTcpConnections = computed(() => {
    const custom = profileState.value?.tcp_connections;
    if (custom != null) return custom;
    return resolvedGlobalTcp.value ?? DEFAULT_TCP_ROUTES;
  });

  const resolvedUdpConnections = computed(() => {
    const custom = profileState.value?.udp_connections;
    if (custom != null) return custom;
    return resolvedGlobalUdp.value ?? DEFAULT_UDP_ROUTES;
  });

  const stickyTopConnectionId = ref<string | null>(null);
  const { selectedConnectionId } = useProfileChartConnection(
    () => profileRef.value?.id ?? ""
  );

  watch(
    () => profileRef.value?.id,
    () => {
      stickyTopConnectionId.value = null;
    }
  );

  const topConnection = computed(() => {
    const profileId = profileRef.value?.id ?? "";
    const list = (connections.value ?? []).filter(
      (connection) => connection.profile_id === profileId
    );
    const manualId = selectedConnectionId.value;
    if (manualId) {
      const manual = list.find((connection) => connection.id === manualId);
      if (manual) {
        return manual;
      }
      return pickTopProfileConnection(
        profileId,
        connections.value ?? [],
        stickyTopConnectionId.value
      );
    }
    return pickTopProfileConnection(
      profileId,
      connections.value ?? [],
      stickyTopConnectionId.value
    );
  });

  watch(
    [() => selectedConnectionId.value, connections, () => profileRef.value?.id],
    () => {
      const manualId = selectedConnectionId.value;
      if (!manualId) {
        return;
      }
      const profileId = profileRef.value?.id ?? "";
      const stillLive = (connections.value ?? []).some(
        (connection) =>
          connection.profile_id === profileId && connection.id === manualId
      );
      if (!stillLive) {
        selectedConnectionId.value = null;
      }
    }
  );

  watch(
    topConnection,
    (picked) => {
      if (selectedConnectionId.value) {
        return;
      }
      stickyTopConnectionId.value = picked?.id ?? null;
    },
    { immediate: true }
  );

  const primaryRelayNodeId = computed(() => {
    const connection = topConnection.value;
    if (!connection) {
      return null;
    }
    return connection.relay_route?.tag || connection.node_id || null;
  });

  const shouldShowRoutes = computed(
    () =>
      (profileRef.value.flags & ProfileFlag.MULTIPATH) !== 0 &&
      profileRef.value.route_action === "route"
  );

  const routeSlotCount = computed(() => {
    if (!shouldShowRoutes.value || !profileState.value) {
      return 0;
    }

    return Math.min(
      MAX_ROUTE_SLOTS,
      Math.max(1, resolvedTcpConnections.value + resolvedUdpConnections.value)
    );
  });

  const interfaceCount = computed(() => {
    const selected = profileState.value?.network_interfaces?.length ?? 0;
    return selected > 0 ? selected : 1;
  });

  const matchingRelayNodes = computed(() => {
    if (!shouldShowRoutes.value || !profileState.value) {
      return [];
    }

    return Object.values(store.nodes).filter((node) => {
      const hasRelay = (node.flags & 0x1) !== 0;
      if (!hasRelay) {
        return false;
      }
      return nodeMatchesSelection(node, profileState.value);
    });
  });

  const hasLiveConnectionRoutes = computed(() => {
    const profileId = profileRef.value?.id ?? "";
    if (
      collectConnectionRoutes(
        profileId,
        connections.value ?? [],
        routeSlotCount.value
      ).length > 0
    ) {
      return true;
    }
    const live = topConnection.value?.relay_route;
    return !!live?.routes?.length;
  });

  const connectionRelayRoute = computed(() => {
    const live = topConnection.value?.relay_route;
    if (live?.routes?.length) {
      return live;
    }

    const nodeId = primaryRelayNodeId.value;
    if (nodeId) {
      return resolveRelayRouteForNode(nodeId, store.routes ?? {});
    }
    return null;
  });

  const connectionDisplayRoutes = computed<NodeRoute[]>(() => {
    const slots = routeSlotCount.value;
    if (slots <= 0) {
      return [];
    }

    const tcpCount = resolvedTcpConnections.value;
    const udpCount = resolvedUdpConnections.value;
    const profileId = profileRef.value?.id ?? "";
    const fromConnections = collectConnectionRoutes(
      profileId,
      connections.value ?? [],
      slots
    );
    const pool =
      fromConnections.length > 0
        ? fromConnections
        : routesFromRelayRoute(connectionRelayRoute.value, slots);

    // Always re-apply TCP/UDP counts from Route Settings so labels match the
    // panel (0 TCP / 2 UDP → UDP chips), not optimizer dual-capability flags.
    return expandRoutesForTransportCounts(pool, tcpCount, udpCount);
  });

  const demoDisplayRoutes = computed<NodeRoute[]>(() => {
    if (!shouldShowRoutes.value || !profileState.value) {
      return [];
    }
    if (profileState.value.mode === RoutingMode.RoutingMode_ROUTING_MODE_DIRECT) {
      return [];
    }
    if (matchingRelayNodes.value.length === 0) {
      return [];
    }

    const tcpCount = resolvedTcpConnections.value;
    const udpCount = resolvedUdpConnections.value;
    return buildMultipathRoutesFromPool(
      matchingRelayNodes.value,
      store.routes ?? {},
      tcpCount,
      udpCount
    );
  });

  const isUsingDemoRoutes = computed(
    () => !hasLiveConnectionRoutes.value && demoDisplayRoutes.value.length > 0
  );

  const bestRelayRoute = computed(() => {
    if (hasLiveConnectionRoutes.value) {
      return connectionRelayRoute.value;
    }
    return findBestRelayRoute(matchingRelayNodes.value, store.routes ?? {});
  });

  const displayRoutes = computed<NodeRoute[]>(() => {
    if (hasLiveConnectionRoutes.value) {
      return connectionDisplayRoutes.value;
    }
    return demoDisplayRoutes.value;
  });

  const profileInterfaces = computed(() => {
    const selected = profileState.value?.network_interfaces ?? [];
    if (selected.length > 0) {
      return selected;
    }
    if (store.defaultInterface) {
      return [store.defaultInterface];
    }
    const first = store.interfaces?.[0]?.Name;
    return first ? [first] : ["Default"];
  });

  const interfaceRouteGroups = computed(() => {
    const slots = routeSlotCount.value;
    if (slots <= 0) {
      return [];
    }

    // Same top-N path topology for every selected interface, but each group's
    // hop legs / RTT come only from that interface's own probe samples.
    // Keep source slot order stable — legs may rotate under the same slot;
    // re-sorting after probe apply would reshuffle chart series identities.
    const sourceRoutes = sortRoutesByLatency(displayRoutes.value).slice(0, slots);
    const probeSlots = latestRelayProbeSlots();

    return profileInterfaces.value.map((name, index) => {
      const routes = sourceRoutes.map((route, slotIndex) => {
        const globalIndex = index * slots + slotIndex;
        const pathKey = nodeRoutePathKey(route);
        const topologyFloor = routeHopFloorMs(route);
        const probe = pickIfaceProbeSlot(
          probeSlots,
          name,
          pathKey,
          slotIndex,
          globalIndex,
          route,
          topologyFloor
        );
        return applyIfaceProbeToRoute(route, probe, topologyFloor);
      });
      return {
        index,
        name,
        routes,
        bestRoute: routes[0] ?? null,
      };
    });
  });

  function latestRelayProbeSlots(): RouteProbeSlotMetric[] {
    const tag = primaryRelayNodeId.value;
    if (!tag) {
      return [];
    }
    const history = routeProbeHistory.value;
    const candidates = [
      tag,
      `${tag}-ipv4-udp`,
      `${tag}-ipv4-tcp`,
      `${tag}-ipv6-udp`,
      `${tag}-ipv6-tcp`,
    ];
    for (const key of candidates) {
      const events = history[key];
      if (events?.length) {
        return events[events.length - 1]?.slots ?? [];
      }
    }
    for (const [key, events] of Object.entries(history)) {
      if (!events?.length) {
        continue;
      }
      if (key === tag || key.startsWith(`${tag}-`)) {
        return events[events.length - 1]?.slots ?? [];
      }
    }
    return [];
  }

  function pickIfaceProbeSlot(
    slots: RouteProbeSlotMetric[],
    iface: string,
    pathKey: string,
    _slotIndex: number,
    globalSlot: number,
    route: NodeRoute | null,
    topologyFloorMs?: number
  ): RouteProbeSlotMetric | null {
    if (!slots.length) {
      return null;
    }

    const pickBest = (candidates: RouteProbeSlotMetric[]) => {
      const udp = candidates.filter(
        (slot) => !slot.network || slot.network === "udp"
      );
      const pool = udp.length > 0 ? udp : candidates;
      // Latest plausible sample — never the lucky minimum (that produced 20ms).
      let best: RouteProbeSlotMetric | null = null;
      for (const slot of pool) {
        const latency = slot.latency ?? 0;
        if (!isPlausibleProbeForRoute(latency, route, topologyFloorMs)) {
          continue;
        }
        best = slot;
      }
      return best;
    };

    const hasNamed = slots.some((slot) => !!slot.iface);
    const ifaceSlots = hasNamed
      ? slots
          .filter((slot) => slot.iface === iface)
          .slice()
          .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
      : [];

    // Prefer exact path when the current leg is still being probed.
    if (hasNamed && pathKey) {
      const pathSlots = ifaceSlots.filter((slot) => slot.path_key === pathKey);
      const byPath = pickBest(pathSlots);
      if (byPath) {
        return byPath;
      }
      // Timeout / nonsense RTT — still return so packet_loss paints on the diagram.
      const miss = pathSlots.find((slot) => (slot.packet_loss ?? 0) > 0 || !(slot.latency > 0));
      if (miss) {
        return miss;
      }
      return null;
    }

    // Legacy flat-packed slots: iface0 → slots 0..n-1, iface1 → n..2n-1.
    const legacy = pickBest(slots.filter((slot) => slot.slot === globalSlot));
    if (legacy) {
      return legacy;
    }
    const legacyMiss = slots.find(
      (slot) =>
        slot.slot === globalSlot &&
        ((slot.packet_loss ?? 0) > 0 || !(slot.latency > 0))
    );
    return legacyMiss ?? null;
  }

  const numberOfRoutes = computed(() => routeSlotCount.value);

  const diagramRoutes = computed<NodeRoute[]>(() => {
    return interfaceRouteGroups.value[0]?.routes ?? [];
  });

  const bestEstimatedPing = computed(() => {
    const allRoutes = interfaceRouteGroups.value.flatMap((group) => group.routes);
    const best = bestRouteRelayLatency(allRoutes);
    return {
      ping: best.ping,
      score: best.score,
      loss: best.loss,
      route: best.route,
    };
  });

  const routeSeries = computed(() => {
    const slots = routeSlotCount.value;
    if (slots <= 0) {
      return [];
    }

    return interfaceRouteGroups.value.flatMap((group) =>
      group.routes.map((route, slotIndex) => {
        const globalIndex = group.index * slots + slotIndex;
        const hopIp = route.hops?.[0]?.ip;
        const hopLabel =
          hopIp && getNodeLabelByIp(hopIp) !== "Server"
            ? getNodeLabelByIp(hopIp)
            : `Route ${slotIndex + 1}`;
        // Stable identity = iface + slot. Hop label may change on route swap;
        // history/chart series must keep the same key.
        const key = `${group.name || "iface"}::${slotIndex}`;
        const label = group.name ? `${hopLabel} (${group.name})` : hopLabel;

        return {
          index: globalIndex,
          route,
          key,
          label,
          iface: group.name,
          slot: slotIndex,
          hopFloorMs: routeHopFloorMs(route),
        };
      })
    );
  });

  /**
   * Chart series for the interface selector.
   * - Best Internet → every selected NIC (so Ethernet + Ethernet 2 both appear).
   * - A named NIC → that group's route slots only.
   */
  function chartSeriesForInterface(selectedKey: string) {
    const all = routeSeries.value;
    const groups = interfaceRouteGroups.value;
    if (all.length === 0 || groups.length === 0) {
      return [];
    }
    if (selectedKey === "best" || !selectedKey || groups.length === 1) {
      return all;
    }

    const group =
      groups.find((item) => item.name === selectedKey) ??
      pickBestInterfaceGroup(groups);

    if (!group) {
      return all;
    }
    return all.filter((series) => series.iface === group.name);
  }

  /** Default chart series when no selector is wired (all profile NICs). */
  const chartRouteSeries = computed(() => chartSeriesForInterface("best"));

  return {
    shouldShowRoutes,
    routeSlotCount,
    interfaceCount,
    numberOfRoutes,
    matchingRelayNodes,
    topConnection,
    primaryRelayNodeId,
    hasLiveConnectionRoutes,
    isUsingDemoRoutes,
    connectionRelayRoute,
    connectionDisplayRoutes,
    demoDisplayRoutes,
    bestRelayRoute,
    displayRoutes,
    diagramRoutes,
    profileInterfaces,
    interfaceRouteGroups,
    bestEstimatedPing,
    routeSeries,
    chartRouteSeries,
    chartSeriesForInterface,
  };
}
