import { computed, type MaybeRef, toValue } from "vue";
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

const ROUTE_VARIANTS = ["ipv4-udp", "ipv4-tcp", "ipv6-udp", "ipv6-tcp"] as const;
const MAX_ROUTE_SLOTS = 4;

function connectionTraffic(connection: Connection) {
  return (connection.download_speed || 0) + (connection.upload_speed || 0);
}

export function pickTopProfileConnection(
  profileId: string,
  connections: Connection[]
): Connection | null {
  const profileConnections = connections.filter(
    (connection) => connection.profile_id === profileId
  );
  if (profileConnections.length === 0) {
    return null;
  }

  return [...profileConnections].sort((a, b) => {
    const trafficDelta = connectionTraffic(b) - connectionTraffic(a);
    if (trafficDelta !== 0) {
      return trafficDelta;
    }
    const latencyA = a.min_latency || a.avg_latency || Infinity;
    const latencyB = b.min_latency || b.avg_latency || Infinity;
    return latencyA - latencyB;
  })[0];
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

/** Scale hop legs so their sum matches a measured end-to-end RTT. */
export function syncRouteHopLatencies(route: NodeRoute, total: number): void {
  const hops = route.hops ?? [];
  if (!hops.length || !(total > 0)) {
    return;
  }
  if (hops.length === 1) {
    hops[0].latency = Math.round(total);
    return;
  }
  const sum = hops.reduce((acc, hop) => acc + (hop.latency || 0), 0);
  if (sum <= 0) {
    hops[0].latency = Math.round(total);
    return;
  }
  const scale = total / sum;
  let assigned = 0;
  for (let i = 0; i < hops.length; i++) {
    if (i === hops.length - 1) {
      hops[i].latency = Math.round(total) - assigned;
      continue;
    }
    hops[i].latency = Math.round((hops[i].latency || 0) * scale);
    assigned += hops[i].latency || 0;
  }
}

/** Apply one interface's probe RTT onto a cloned route — never another NIC's data. */
export function applyIfaceProbeToRoute(
  route: NodeRoute,
  probe: { latency?: number; packet_loss?: number; jitter?: number; score?: number } | null | undefined
): NodeRoute {
  const cloned = cloneNodeRoute(route);
  const latency = probe?.latency ?? 0;
  if (!(latency > 0)) {
    // No NIC probe yet — keep discovery/route latencies so the diagram and
    // estimated ping still reflect the selected routes from settings defaults.
    return cloned;
  }
  cloned.avg_latency = latency;
  cloned.min_latency = Math.round(latency);
  if (!cloned.max_latency || cloned.max_latency < latency) {
    cloned.max_latency = Math.round(latency);
  }
  if (probe?.packet_loss != null) {
    cloned.packet_loss = probe.packet_loss;
  }
  if (probe?.jitter != null) {
    cloned.jitter = probe.jitter;
  }
  if (probe?.score != null && probe.score > 0) {
    cloned.score = probe.score;
  }
  syncRouteHopLatencies(cloned, latency);
  return cloned;
}

/** Latency to the relay: sum of hop leg times shown on the route diagram. */
export function routeRelayLatency(route: NodeRoute | null | undefined): number {
  if (!route) {
    return 0;
  }

  const hops = route.hops ?? [];
  if (hops.length > 0) {
    const hopSum = hops.reduce((sum, hop) => sum + (hop.latency || 0), 0);
    if (hopSum > 0) {
      return hopSum;
    }
  }

  return route.min_latency || route.avg_latency || 0;
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
): { ping: number; score: number; route: NodeRoute | null } {
  let best: { ping: number; score: number; route: NodeRoute | null } = {
    ping: 0,
    score: 0,
    route: null,
  };

  for (const route of routes) {
    const metrics = routeRelayMetrics(route);
    const ping = metrics.estimated;
    if (ping <= 0) {
      continue;
    }
    if (best.ping === 0 || ping < best.ping) {
      best = { ping: Math.round(ping), score: metrics.score || 0, route };
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
    for (const route of connection.relay_route!.routes!) {
      const key = nodeRouteSlotKey(route);
      if (key) {
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
      }
      merged.push(route);
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

  const topConnection = computed(() =>
    pickTopProfileConnection(profileRef.value?.id ?? "", connections.value ?? [])
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
      resolvedTcpConnections.value + resolvedUdpConnections.value
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

    const profileId = profileRef.value?.id ?? "";
    const maxRoutes = slots * interfaceCount.value;
    const fromConnections = collectConnectionRoutes(
      profileId,
      connections.value ?? [],
      maxRoutes
    );
    if (fromConnections.length > 0) {
      return fromConnections;
    }

    return routesFromRelayRoute(connectionRelayRoute.value, maxRoutes);
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
    // Do not path-dedupe here: TCP/UDP counts may intentionally reuse a hop
    // path (or pad when the discovery pool is smaller than the slot count).
    const sourceRoutes = displayRoutes.value.slice(0, slots);
    const probeSlots = latestRelayProbeSlots();

    return profileInterfaces.value.map((name, index) => {
      const routes = sortRoutesByLatency(
        sourceRoutes.map((route, slotIndex) => {
          const globalIndex = index * slots + slotIndex;
          const pathKey = nodeRoutePathKey(route);
          const probe = pickIfaceProbeSlot(
            probeSlots,
            name,
            pathKey,
            slotIndex,
            globalIndex
          );
          return applyIfaceProbeToRoute(route, probe);
        })
      );
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
    slotIndex: number,
    globalSlot: number
  ): RouteProbeSlotMetric | null {
    const hasNamed = slots.some((slot) => !!slot.iface);

    const pickBest = (candidates: RouteProbeSlotMetric[]) => {
      const udp = candidates.filter(
        (slot) => !slot.network || slot.network === "udp"
      );
      const pool = udp.length > 0 ? udp : candidates;
      let best: RouteProbeSlotMetric | null = null;
      for (const slot of pool) {
        if (!(slot.latency > 0)) {
          continue;
        }
        if (!best || slot.latency < best.latency) {
          best = slot;
        }
      }
      return best;
    };

    // Unnamed history is flat-packed: iface0 → slots 0..n-1, iface1 → n..2n-1.
    // Never assign the same sample to every NIC via path_key alone.
    if (!hasNamed) {
      return pickBest(slots.filter((slot) => slot.slot === globalSlot));
    }

    const ifaceSlots = slots.filter((slot) => slot.iface === iface);

    let best = pickBest(
      ifaceSlots.filter((slot) => slot.path_key === pathKey)
    );
    if (best) {
      return best;
    }

    best = pickBest(ifaceSlots.filter((slot) => slot.slot === slotIndex));
    if (best) {
      return best;
    }

    return pickBest(ifaceSlots.filter((slot) => slot.slot === globalSlot));
  }

  const numberOfRoutes = computed(() =>
    interfaceRouteGroups.value.reduce((count, group) => count + group.routes.length, 0)
  );

  const diagramRoutes = computed<NodeRoute[]>(() => {
    return interfaceRouteGroups.value[0]?.routes ?? [];
  });

  const bestEstimatedPing = computed(() => {
    const allRoutes = interfaceRouteGroups.value.flatMap((group) => group.routes);
    const best = bestRouteRelayLatency(allRoutes);
    return { ping: best.ping, score: best.score, route: best.route };
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
        };
      })
    );
  });

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
  };
}
