import { computed, ref, watch, type MaybeRef, toValue } from "vue";
import type { Profile, NodeRoute, RelayRoute } from "~/bindings/github.com/lagzap/zap/data";
import { RoutingMode } from "~/bindings/github.com/lagzap/zap/data";
import { ProfileFlag } from "~/constants/profile";
import type { Connection, RouteProbeEvent, RouteProbeSlotMetric } from "~/types/monitoring";
import {
  buildNodeLocationLabelMap,
  nodeCityGroupKey,
} from "~/composables/useNodeLocationLabel";
import { useNetworkAdapterSettings } from "~/composables/useNetworkAdapterSettings";
import {
  DEFAULT_TCP_ROUTES,
  DEFAULT_UDP_ROUTES,
  resolveProfileRouteCounts,
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
  const hop0 = hops[0]?.latency ?? 0;
  // Unknown (−1) or direct (0) entry: path-matrix exit stubs (0–7ms) are NOT a floor.
  if (!(hop0 > 0)) {
    const measured = route.avg_latency || route.min_latency || 0;
    return measured > 0 ? measured : 0;
  }
  // Prefer the largest measured hop leg — entry cities (~100ms) beat exit stubs (0–7ms).
  let bestHop = hop0;
  for (const hop of hops) {
    const ms = hop.latency ?? 0;
    if (ms > bestHop) {
      bestHop = ms;
    }
  }
  return bestHop;
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

/** Case-insensitive iface|nodeId|ipv4|udp lookup (no IP addresses). */
export function lookupIfaceEntryRttMs(
  entryRtt: Record<string, number> | null | undefined,
  iface: string,
  nodeId: string,
  ipVersion: "ipv4" | "ipv6" | "all" = "all",
  networks: readonly ("udp" | "tcp" | "icmp")[] = ["udp", "tcp", "icmp"]
): number {
  if (!entryRtt || !iface || !nodeId) {
    return 0;
  }
  const wantIface = iface.trim().toLowerCase();
  const wantNode = nodeId.trim().toLowerCase();
  const versions =
    ipVersion === "all" ? (["ipv4", "ipv6"] as const) : ([ipVersion] as const);
  let best = 0;
  for (const [key, sample] of Object.entries(entryRtt)) {
    if (!(typeof sample === "number" && sample > 0)) {
      continue;
    }
    const parts = key.split("|");
    if (parts.length < 4) {
      continue;
    }
    const [keyIface, keyNode, keyVer, keyNet] = parts;
    if ((keyIface || "").trim().toLowerCase() !== wantIface) {
      continue;
    }
    if ((keyNode || "").trim().toLowerCase() !== wantNode) {
      continue;
    }
    const ver = (keyVer || "").toLowerCase();
    if (!(versions as readonly string[]).includes(ver)) {
      continue;
    }
    const net = (keyNet || "").toLowerCase();
    if (!(networks as readonly string[]).includes(net)) {
      continue;
    }
    if (best <= 0 || sample < best) {
      best = sample;
    }
  }
  return best;
}

/** Resolve hop IP → node id using the nodes store (RTT keys never use IPs). */
export function nodeIdForHopIp(
  nodes: Record<string, { id?: string; ipv4?: string; ipv6?: string } | null | undefined>,
  ip: string | null | undefined
): { nodeId: string; ipVersion: "ipv4" | "ipv6" } | null {
  const want = (ip || "").trim();
  if (!want || !nodes) {
    return null;
  }
  for (const node of Object.values(nodes)) {
    if (!node) {
      continue;
    }
    if (node.ipv4 && node.ipv4 === want) {
      return { nodeId: node.id || "", ipVersion: "ipv4" };
    }
    if (node.ipv6 && node.ipv6 === want) {
      return { nodeId: node.id || "", ipVersion: "ipv6" };
    }
  }
  return null;
}

/**
 * Topology without shared client RTT. Clears hop0 + avg so a named NIC never
 * inherits another NIC's measurement. Hop0 stays unset (not painted as 0ms) —
 * callers should overlay last-known per-NIC RTT when available.
 */
export function blankIfaceRouteMetrics(route: NodeRoute): NodeRoute {
  const cloned = cloneNodeRoute(route);
  cloned.avg_latency = 0;
  cloned.min_latency = 0;
  cloned.max_latency = 0;
  cloned.packet_loss = 0;
  const hops = cloned.hops ?? [];
  if (hops[0]) {
    // Use -1 as "unknown" so the diagram does not flash a fake 0ms ping.
    hops[0].latency = -1;
  }
  return cloned;
}

/**
 * Apply one interface's probe RTT onto a cloned route — never another NIC's data.
 * Without a probe: blank shared client RTT so this NIC cannot inherit optimize merge.
 */
export function applyIfaceProbeToRoute(
  route: NodeRoute,
  probe: { latency?: number; packet_loss?: number; jitter?: number; score?: number } | null | undefined,
  topologyFloorMs?: number
): NodeRoute {
  if (!probe) {
    return blankIfaceRouteMetrics(route);
  }

  const cloned = cloneNodeRoute(route);
  const floor =
    topologyFloorMs && topologyFloorMs > 0
      ? topologyFloorMs
      : routeHopFloorMs(cloned);
  const latency = probe.latency ?? 0;
  const loss = probe.packet_loss ?? 0;

  // Drop metrics that may have been merged from a preferred NIC onto the
  // shared RelayRoute — only this iface's probe may refill them.
  cloned.packet_loss = 0;
  cloned.avg_latency = 0;
  cloned.min_latency = 0;
  cloned.max_latency = 0;

  // Always surface loss from this probe round only as a hint — callers overwrite
  // with a recent-window rate so one miss is not painted as permanent 100%.
  if (loss > 0) {
    cloned.packet_loss = loss;
  } else if (!(latency > 0)) {
    cloned.packet_loss = 100;
  }

  // Ignore failed / roof-spike / impossibly-fast probes for RTT — keep hop floor.
  if (!isPlausibleProbeForRoute(latency, cloned, floor)) {
    return cloned;
  }

  cloned.avg_latency = latency;
  cloned.min_latency = Math.round(latency);
  cloned.max_latency = Math.round(latency);
  if (probe.jitter != null) {
    cloned.jitter = probe.jitter;
  }
  if (probe.score != null && probe.score > 0) {
    cloned.score = probe.score;
  }

  const hops = cloned.hops ?? [];
  if (hops.length <= 1) {
    syncRouteHopLatencies(cloned, latency);
  } else if (hops[0]) {
    // Diagram first-leg label is client→entry — stamp this NIC's measured RTT
    // (minus downstream path-matrix legs when that still leaves a positive hop0).
    const rest = hops
      .slice(1)
      .reduce((sum, hop) => sum + (hop.latency || 0), 0);
    const hop0 =
      rest > 0 && latency > rest + 5
        ? Math.round(latency - rest)
        : Math.round(latency);
    hops[0].latency = Math.max(1, hop0);
  }
  return cloned;
}

/** End-to-end RTT to the relay — never report below the client→entry hop floor. */
export function routeRelayLatency(route: NodeRoute | null | undefined): number {
  if (!route) {
    return 0;
  }

  const hops = route.hops ?? [];
  const hop0Raw = hops[0]?.latency;
  // Unknown client→entry (−1 / missing): do NOT invent ping from exit stubs (6ms).
  const hop0Unknown =
    hops.length > 0 &&
    (hop0Raw == null || Number.isNaN(hop0Raw) || hop0Raw < 0);
  if (hop0Unknown) {
    const measured = route.avg_latency || route.min_latency || 0;
    if (measured > 0 && isPlausibleProbeForRoute(measured, route, 0)) {
      return Math.round(measured);
    }
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

  if (hops.length === 0) {
    return floor > 0 ? Math.round(floor) : 0;
  }
  if (hops.length === 1) {
    const only = hops[0]?.latency ?? 0;
    // Direct single-hop with true 0 is not a useful E2E ping.
    if (!(only > 0)) {
      return floor > 0 ? Math.round(floor) : 0;
    }
    return clampToFloor(only);
  }

  const hopSum = hops.reduce((sum, hop) => {
    const ms = hop.latency ?? 0;
    return sum + (ms > 0 ? ms : 0);
  }, 0);
  const hop0 = hop0Raw != null && hop0Raw > 0 ? hop0Raw : 0;
  // All-stub path matrix (tiny hop0 + tiny edges) without a real E2E sample.
  if (
    hops.length > 1 &&
    hop0 > 0 &&
    hop0 < 20 &&
    hopSum > 0 &&
    hopSum < 40 &&
    !(measured > 0 && isPlausibleProbeForRoute(measured, route, floor))
  ) {
    return 0;
  }
  // hop0 is known 0 (direct entry=relay) + only stub downstream → not a ping.
  if (!(hop0 > 0) && hopSum > 0 && hopSum < 40) {
    return 0;
  }
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

/**
 * Simple/unified mode: per path keep the better of TCP vs UDP (UDP on tie),
 * then take the top `cap` paths — mirrors coordinator.PickBestTransportMix.
 */
export function expandRoutesForBestMix(pool: NodeRoute[], cap: number): NodeRoute[] {
  const limit = Math.max(1, Math.min(MAX_ROUTE_SLOTS, Math.round(cap) || 1));
  if (!pool.length) {
    return [];
  }

  type Cand = { route: NodeRoute; network: "tcp" | "udp"; latency: number; path: string };
  const cands: Cand[] = [];
  for (const route of pool) {
    const latency =
      typeof route.min_latency === "number" && route.min_latency > 0
        ? route.min_latency
        : typeof route.avg_latency === "number" && route.avg_latency > 0
          ? route.avg_latency
          : Number.POSITIVE_INFINITY;
    const path = nodeRoutePathKey(route);
    const tcpOnly = !!route.tcp_available && !route.udp_available;
    const udpOnly = !!route.udp_available && !route.tcp_available;
    if (tcpOnly) {
      cands.push({ route, network: "tcp", latency, path });
    } else if (udpOnly) {
      cands.push({ route, network: "udp", latency, path });
    } else {
      if (route.tcp_available !== false) {
        cands.push({ route, network: "tcp", latency, path });
      }
      if (route.udp_available !== false) {
        cands.push({ route, network: "udp", latency, path });
      }
    }
  }

  const better = (a: Cand, b: Cand) => {
    if (a.latency !== b.latency) return a.latency < b.latency;
    if (a.network !== b.network) return a.network === "udp";
    return a.path < b.path;
  };

  // One winner per path — better transport; UDP when equal.
  const byPath = new Map<string, Cand>();
  for (const c of cands) {
    const prev = byPath.get(c.path);
    if (!prev || better(c, prev)) {
      byPath.set(c.path, c);
    }
  }
  const winners = [...byPath.values()].sort((a, b) => (better(a, b) ? -1 : 1));

  const out: NodeRoute[] = [];
  const usedPath = new Set<string>();
  const usedHop = new Set<string>();

  const tryPick = (c: Cand, requireNewHop: boolean) => {
    if (usedPath.has(c.path)) return;
    const hop = c.path.split("->")[0] || c.path;
    if (requireNewHop && hop && usedHop.has(hop)) return;
    usedPath.add(c.path);
    if (hop) usedHop.add(hop);
    out.push(tagRouteNetwork(c.route, c.network));
  };

  for (const c of winners) {
    if (out.length >= limit) break;
    tryPick(c, true);
  }
  for (const c of winners) {
    if (out.length >= limit) break;
    tryPick(c, false);
  }
  return out.slice(0, limit);
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

/** Unified cap: merge TCP+UDP relay pools and pick the best mix. */
export function buildBestMixRoutesFromPool(
  matchingNodes: any[],
  routes: Record<string, RelayRoute>,
  cap: number
): NodeRoute[] {
  const nodeId = findBestNodeId(matchingNodes, routes);
  if (!nodeId) {
    return [];
  }
  const tcpRoutes = relayRoutesForNode(routes, nodeId, "tcp").map((r) =>
    tagRouteNetwork(r, "tcp")
  );
  const udpRoutes = relayRoutesForNode(routes, nodeId, "udp").map((r) =>
    tagRouteNetwork(r, "udp")
  );
  return expandRoutesForBestMix([...tcpRoutes, ...udpRoutes], cap);
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
  const { connections, routeProbeHistory, routeProbeReceivedCount } =
    useMonitoringStore();
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
  const resolvedRouteCounts = computed(() =>
    resolveProfileRouteCounts(profileState.value, {
      tcp: resolvedGlobalTcp.value ?? DEFAULT_TCP_ROUTES,
      udp: resolvedGlobalUdp.value ?? DEFAULT_UDP_ROUTES,
    })
  );

  const resolvedTcpConnections = computed(() => resolvedRouteCounts.value.tcp);
  const resolvedUdpConnections = computed(() => resolvedRouteCounts.value.udp);
  const resolvedRouteCap = computed(() => resolvedRouteCounts.value.total);
  const usesUnifiedRoutes = computed(() => resolvedRouteCounts.value.unified);

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

    const flags = profileRef.value?.flags ?? 0;
    const preventDisconnect =
      (flags & ProfileFlag.PREVENT_DISCONNECT) !== 0 &&
      (flags & ProfileFlag.MULTIPATH) === 0;
    if (preventDisconnect) {
      return 1;
    }

    if (usesUnifiedRoutes.value) {
      return Math.min(MAX_ROUTE_SLOTS, Math.max(1, resolvedRouteCap.value));
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

    if (usesUnifiedRoutes.value) {
      return expandRoutesForBestMix(pool, slots);
    }

    const tcpCount = resolvedTcpConnections.value;
    const udpCount = resolvedUdpConnections.value;
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

    if (usesUnifiedRoutes.value) {
      return buildBestMixRoutesFromPool(
        matchingRelayNodes.value,
        store.routes ?? {},
        resolvedRouteCap.value
      );
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
    const recentEvents = recentRelayProbeEvents();
    const entryRtt = store.ifaceEntryRtt ?? {};

    return profileInterfaces.value.map((name, index) => {
      const routes = sourceRoutes.map((route, slotIndex) => {
        const globalIndex = index * slots + slotIndex;
        const pathKey = nodeRoutePathKey(route);
        // Do NOT use shared hop0 as floor — that hop0 is often another NIC's
        // (or "best") stamp and rejects this NIC's real probe as "too fast".
        const matrixFloor = (route.hops ?? [])
          .slice(1)
          .reduce((sum, hop) => sum + (hop.latency || 0), 0);
        let probe: {
          latency?: number;
          packet_loss?: number;
          jitter?: number;
          score?: number;
        } | null = pickIfaceProbeSlot(
          probeSlots,
          name,
          pathKey,
          slotIndex,
          globalIndex,
          route,
          matrixFloor
        );
        // 100% loss miss must not stick as "live" — fall through to this NIC's last good.
        if (probe && (probe.packet_loss ?? 0) >= 100) {
          probe = null;
        }
        // Current tick miss (MCI 100% loss) — use this NIC's last good only.
        if ((!probe || !(probe.latency > 0)) && name) {
          const lastGood = lastGoodIfaceProbeMs(recentEvents, name, pathKey);
          if (lastGood > 0) {
            probe = { latency: lastGood, packet_loss: 0 };
          }
        }
        // No live probe yet — overlay this NIC's optimize entry RTT (node id key).
        if (!probe || !(probe.latency > 0)) {
          const entryIp = route.hops?.[0]?.ip;
          const resolved = nodeIdForHopIp(store.nodes ?? {}, entryIp);
          if (resolved?.nodeId && name) {
            const hop0 = lookupIfaceEntryRttMs(
              entryRtt,
              name,
              resolved.nodeId,
              resolved.ipVersion
            );
            if (hop0 > 0) {
              const rest = (route.hops ?? [])
                .slice(1)
                .reduce((sum, hop) => sum + (hop.latency || 0), 0);
              probe = {
                latency: hop0 + rest,
                packet_loss: probe?.packet_loss ?? 0,
                score: probe?.score,
                jitter: probe?.jitter,
              };
            }
          }
          // Relay node itself (direct / live E2E sample for this NIC only).
          if ((!probe || !(probe.latency > 0)) && name && primaryRelayNodeId.value) {
            const e2e = lookupIfaceEntryRttMs(
              entryRtt,
              name,
              primaryRelayNodeId.value,
              "all"
            );
            if (e2e > 0) {
              probe = {
                latency: e2e,
                packet_loss: probe?.packet_loss ?? 0,
                score: probe?.score,
                jitter: probe?.jitter,
              };
            }
          }
        }
        // Without a per-NIC sample, clear shared hop0 — never paint PTP onto MCI.
        const applied =
          probe && probe.latency > 0
            ? applyIfaceProbeToRoute(route, probe, matrixFloor)
            : blankIfaceRouteMetrics(route);
        // Diagram loss = recent window, not the latest probe tick (that stuck at 100%).
        applied.packet_loss = recentIfacePathLoss(recentEvents, name, pathKey);
        return applied;
      });
      return {
        index,
        name,
        routes,
        bestRoute: routes[0] ?? null,
      };
    });
  });

  /** Last ~30s of probe events for the primary relay (for rolling path loss). */
  function recentRelayProbeEvents(): RouteProbeEvent[] {
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
    let events: RouteProbeEvent[] | undefined;
    for (const key of candidates) {
      if (history[key]?.length) {
        events = history[key];
        break;
      }
    }
    if (!events) {
      for (const [key, list] of Object.entries(history)) {
        if (!list?.length) continue;
        if (key === tag || key.startsWith(`${tag}-`)) {
          events = list;
          break;
        }
      }
    }
    if (!events?.length) {
      return [];
    }
    const cutoff = Date.now() - 30_000;
    const recent = events.filter((event) => {
      const ts = event.timestamp ? new Date(event.timestamp).getTime() : 0;
      return ts >= cutoff;
    });
    // Fallback: last ~60 samples (~30s at 2Hz) when timestamps are missing.
    return recent.length > 0 ? recent : events.slice(-60);
  }

  function recentIfacePathLoss(
    events: RouteProbeEvent[],
    iface: string,
    pathKey: string
  ): number {
    if (!events.length) {
      return 0;
    }
    let total = 0;
    let failed = 0;
    for (const event of events) {
      for (const slot of event.slots ?? []) {
        if (iface && slot.iface && slot.iface !== iface) {
          continue;
        }
        if (pathKey) {
          if (!slot.path_key || slot.path_key !== pathKey) {
            continue;
          }
        }
        total++;
        const latency = slot.latency ?? 0;
        const loss = slot.packet_loss ?? 0;
        if (loss >= 100 || !(latency > 0) || latency >= 500) {
          failed++;
        }
      }
    }
    if (total === 0) {
      return 0;
    }
    return (failed / total) * 100;
  }

  function latestRelayProbeSlots(): RouteProbeSlotMetric[] {
    const tag = primaryRelayNodeId.value;
    // Touch received-count so interface groups recompute when probes arrive.
    void routeProbeReceivedCount.value;
    const history = routeProbeHistory.value;
    if (!tag) {
      // Fall back to whichever relay has the newest probe event.
      let newest: RouteProbeSlotMetric[] = [];
      let newestTs = 0;
      for (const events of Object.values(history)) {
        if (!events?.length) {
          continue;
        }
        const last = events[events.length - 1];
        const ts = last?.timestamp ? new Date(last.timestamp).getTime() : 0;
        if (ts >= newestTs && (last.slots?.length ?? 0) > 0) {
          newestTs = ts;
          newest = last.slots ?? [];
        }
      }
      return newest;
    }
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
      if (key === tag || key.startsWith(`${tag}-`) || tag.startsWith(`${key}-`)) {
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
    _globalSlot: number,
    route: NodeRoute | null,
    topologyFloorMs?: number
  ): RouteProbeSlotMetric | null {
    if (!slots.length) {
      return null;
    }

    const want = (iface || "").trim().toLowerCase();
    // Named NIC view: ONLY this NIC's slots — never legacy index packing (that
    // assigned PTP's slot 0 onto MCI when iface tags were briefly missing).
    if (!want) {
      return null;
    }

    const pickBest = (candidates: RouteProbeSlotMetric[]) => {
      if (!candidates.length) {
        return null;
      }
      const alive = candidates.filter((slot) => (slot.packet_loss ?? 0) < 100);
      const poolSource = alive.length > 0 ? alive : candidates;
      const udp = poolSource.filter(
        (slot) => !slot.network || slot.network === "udp"
      );
      const tcp = poolSource.filter((slot) => slot.network === "tcp");
      const pools =
        udp.length > 0 && tcp.length > 0
          ? [udp, tcp, poolSource]
          : udp.length > 0
            ? [udp, poolSource]
            : [poolSource];

      let best: RouteProbeSlotMetric | null = null;
      for (const pool of pools) {
        for (const slot of pool) {
          if ((slot.packet_loss ?? 0) >= 100) {
            continue;
          }
          const latency = slot.latency ?? 0;
          if (!isPlausibleProbeForRoute(latency, route, topologyFloorMs)) {
            continue;
          }
          if (
            !best ||
            latency < (best.latency ?? Number.POSITIVE_INFINITY)
          ) {
            best = slot;
          }
        }
        if (best) {
          return best;
        }
      }
      return null;
    };

    const ifaceSlots = slots
      .filter((slot) => (slot.iface || "").trim().toLowerCase() === want)
      .slice()
      .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
    if (!ifaceSlots.length) {
      return null;
    }

    if (pathKey) {
      const pathSlots = ifaceSlots.filter((slot) => slot.path_key === pathKey);
      const byPath = pickBest(pathSlots);
      if (byPath) {
        return byPath;
      }
    }
    const bySlotIndex = pickBest(
      ifaceSlots.filter((slot) => slot.slot === slotIndex)
    );
    if (bySlotIndex) {
      return bySlotIndex;
    }
    return pickBest(ifaceSlots);
  }

  /** Last good latency for this NIC+path from recent probe history (not another NIC). */
  function lastGoodIfaceProbeMs(
    events: RouteProbeEvent[],
    iface: string,
    pathKey: string
  ): number {
    const want = (iface || "").trim().toLowerCase();
    if (!want || !events.length) {
      return 0;
    }
    for (let i = events.length - 1; i >= 0; i--) {
      for (const slot of events[i]?.slots ?? []) {
        if ((slot.iface || "").trim().toLowerCase() !== want) {
          continue;
        }
        if (pathKey && slot.path_key && slot.path_key !== pathKey) {
          continue;
        }
        const latency = slot.latency ?? 0;
        if (latency > 0 && (slot.packet_loss ?? 0) < 100) {
          return latency;
        }
      }
    }
    return 0;
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
   * - Best Internet → every selected NIC.
   * - A named NIC → that group's route slots only (never silently fall back to all).
   */
  function chartSeriesForInterface(selectedKey: string) {
    const all = routeSeries.value;
    const groups = interfaceRouteGroups.value;
    if (all.length === 0 || groups.length === 0) {
      return [];
    }
    if (selectedKey === "best" || !selectedKey) {
      return all;
    }
    if (groups.length === 1) {
      return all;
    }

    const want = selectedKey.trim().toLowerCase();
    const group = groups.find(
      (item) => (item.name || "").trim().toLowerCase() === want
    );
    if (!group) {
      return [];
    }
    return all.filter(
      (series) => (series.iface || "").trim().toLowerCase() === want
    );
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
