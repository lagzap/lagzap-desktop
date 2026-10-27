import type { NodeRoute, RelayRoute } from "~/bindings/github.com/lagzap/zap/data";

const MAX_ROUTE_SLOTS = 4;

export function nodeRoutePathKey(route: NodeRoute): string {
  return (route.hops ?? []).map((hop) => hop.ip || "").join("->");
}

/** Path + transport — TCP and UDP are distinct slots even with the same hops. */
function nodeRouteSlotKey(
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

/**
 * Path-matrix / exit-stub legs are typically 0–15ms. Real client→edge RTT from
 * Iran (and most remote users) is never in that band — treating stubs as hop0
 * made city cards show 1–8ms and drift downward over time.
 */
const ENTRY_RTT_STUB_MAX_MS = 20;

export function isPlausibleEntryRttMs(latency: number): boolean {
  return (
    typeof latency === "number" &&
    Number.isFinite(latency) &&
    latency >= ENTRY_RTT_STUB_MAX_MS &&
    latency < 500
  );
}

/** Pre-normalized iface|node|ver|net → RTT for O(1) lookups. */
export type IfaceEntryRttIndex = {
  byKey: Map<string, number>;
  /** Distinct iface display names (first spelling seen). */
  ifaces: string[];
};

/** Hop IP → node id / stack. */
export type NodeIpIndex = Map<
  string,
  { nodeId: string; ipVersion: "ipv4" | "ipv6" }
>;

/**
 * Build once per latency refresh — avoids scanning every entryRtt key on each
 * hop/route/iface lookup (was the #1 CPU hotspot with many routes).
 */
export function buildIfaceEntryRttIndex(
  entryRtt: Record<string, number> | null | undefined
): IfaceEntryRttIndex {
  const byKey = new Map<string, number>();
  const ifaceSet = new Map<string, string>();
  if (!entryRtt) {
    return { byKey, ifaces: [] };
  }
  for (const [key, sample] of Object.entries(entryRtt)) {
    if (!isPlausibleEntryRttMs(sample)) {
      continue;
    }
    const parts = key.split("|");
    if (parts.length < 4) {
      continue;
    }
    const ifaceRaw = (parts[0] || "").trim();
    const nodeRaw = (parts[1] || "").trim();
    if (!ifaceRaw || !nodeRaw) {
      continue;
    }
    const iface = ifaceRaw.toLowerCase();
    const node = nodeRaw.toLowerCase();
    const ver = (parts[2] || "").toLowerCase();
    const net = (parts[3] || "").toLowerCase();
    if (!ifaceSet.has(iface)) {
      ifaceSet.set(iface, ifaceRaw);
    }
    const norm = `${iface}|${node}|${ver}|${net}`;
    // Prefer a newer/larger remote sample over a stub that slipped through.
    const prev = byKey.get(norm);
    if (prev == null || sample > prev) {
      byKey.set(norm, sample);
    }
  }
  return { byKey, ifaces: [...ifaceSet.values()] };
}

export function buildNodeIpIndex(
  nodes:
    | Record<string, { id?: string; ipv4?: string; ipv6?: string } | null | undefined>
    | null
    | undefined
): NodeIpIndex {
  const map: NodeIpIndex = new Map();
  if (!nodes) {
    return map;
  }
  for (const node of Object.values(nodes)) {
    if (!node?.id) {
      continue;
    }
    if (node.ipv4) {
      map.set(node.ipv4, { nodeId: node.id, ipVersion: "ipv4" });
    }
    if (node.ipv6) {
      map.set(node.ipv6, { nodeId: node.id, ipVersion: "ipv6" });
    }
  }
  return map;
}

/** Case-insensitive iface|nodeId|ipv4|udp lookup (no IP addresses). */
export function lookupIfaceEntryRttMs(
  entryRtt: Record<string, number> | null | undefined,
  iface: string,
  nodeId: string,
  ipVersion: "ipv4" | "ipv6" | "all" = "all",
  networks: readonly ("udp" | "tcp" | "icmp")[] = ["udp", "tcp", "icmp"],
  index?: IfaceEntryRttIndex | null
): number {
  if (!iface || !nodeId) {
    return 0;
  }
  const idx = index ?? (entryRtt ? buildIfaceEntryRttIndex(entryRtt) : null);
  if (!idx?.byKey.size) {
    return 0;
  }
  const wantIface = iface.trim().toLowerCase();
  const wantNode = nodeId.trim().toLowerCase();
  const versions =
    ipVersion === "all" ? (["ipv4", "ipv6"] as const) : ([ipVersion] as const);
  let best = 0;
  for (const ver of versions) {
    for (const net of networks) {
      const sample = idx.byKey.get(`${wantIface}|${wantNode}|${ver}|${net}`);
      if (
        typeof sample === "number" &&
        sample >= ENTRY_RTT_STUB_MAX_MS &&
        sample < 500 &&
        (best <= 0 || sample < best)
      ) {
        best = sample;
      }
    }
  }
  return best;
}

/** Resolve hop IP → node id using the nodes store (RTT keys never use IPs). */
export function nodeIdForHopIp(
  nodes: Record<string, { id?: string; ipv4?: string; ipv6?: string } | null | undefined>,
  ip: string | null | undefined,
  index?: NodeIpIndex | null
): { nodeId: string; ipVersion: "ipv4" | "ipv6" } | null {
  const want = (ip || "").trim();
  if (!want) {
    return null;
  }
  if (index) {
    return index.get(want) ?? null;
  }
  if (!nodes) {
    return null;
  }
  return buildNodeIpIndex(nodes).get(want) ?? null;
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

/** Tooltip/chart-friendly metrics aligned with hop path to relay. */
function routeRelayMetrics(route: NodeRoute | null | undefined) {
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

export function relayRoutesForNode(
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

/**
 * Expand dual-capable routes into separate TCP and UDP entries and dedupe by
 * path+transport. Does not merge same-path transports or apply a send cap.
 */
function expandTransportCollections(pool: NodeRoute[]): NodeRoute[] {
  if (!pool.length) {
    return [];
  }

  const expanded: NodeRoute[] = [];
  for (const route of pool) {
    const tcpOnly = !!route.tcp_available && !route.udp_available;
    const udpOnly = !!route.udp_available && !route.tcp_available;
    if (tcpOnly || udpOnly) {
      expanded.push(route);
      continue;
    }
    if (route.tcp_available !== false) {
      expanded.push(tagRouteNetwork(route, "tcp"));
    }
    if (route.udp_available !== false) {
      expanded.push(tagRouteNetwork(route, "udp"));
    }
  }

  const unique: NodeRoute[] = [];
  const seen = new Set<string>();
  for (const route of expanded) {
    const key = nodeRouteSlotKey(route);
    if (key) {
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
    }
    unique.push(route);
  }
  return unique;
}

/**
 * Unified display/send ranking: one transport per path (better of TCP/UDP),
 * distinct user→edge (first hop), sort by latency, take top `cap`.
 * Mirrors coordinator.SelectBestTransportLegs — never two legs sharing an edge.
 */
export function combineAndRankRoutes(pool: NodeRoute[], cap: number): NodeRoute[] {
  const requested = Math.max(1, Math.round(cap) || 1);
  // Profile UI clamps to MAX_ROUTE_SLOTS; callers that pass a larger cap
  // (admin live session) keep every unique-edge winner.
  const limit =
    requested > MAX_ROUTE_SLOTS
      ? Math.min(requested, MAX_ROUTE_SLOTS * 8)
      : Math.min(MAX_ROUTE_SLOTS, requested);
  return rankUniqueEdgeRoutes(pool).slice(0, limit);
}

/** ~1% / 5ms hysteresis so Route X labels don't flap on noise. */
const STICKY_ROUTE_REL_THRESHOLD = 0.01;
const STICKY_ROUTE_ABS_MS = 5;

/** profileId|iface → ordered path keys for Route 1..N. */
const stickyRouteOrderByKey = new Map<string, string[]>();

function isClearlyBetterLatency(
  challengerMs: number,
  incumbentMs: number
): boolean {
  if (!(challengerMs > 0) || !Number.isFinite(challengerMs)) {
    return false;
  }
  if (!(incumbentMs > 0) || !Number.isFinite(incumbentMs)) {
    return true;
  }
  const gain = incumbentMs - challengerMs;
  if (gain < STICKY_ROUTE_ABS_MS) {
    return false;
  }
  return gain / incumbentMs >= STICKY_ROUTE_REL_THRESHOLD;
}

function routeLatencyMs(route: NodeRoute): number {
  if (typeof route.min_latency === "number" && route.min_latency > 0) {
    return route.min_latency;
  }
  if (typeof route.avg_latency === "number" && route.avg_latency > 0) {
    return route.avg_latency;
  }
  return Number.POSITIVE_INFINITY;
}

/** Unique-edge winners sorted by latency (uncapped except MAX_ROUTE_SLOTS*2). */
function rankUniqueEdgeRoutes(pool: NodeRoute[]): NodeRoute[] {
  if (!pool.length) {
    return [];
  }

  type Cand = {
    route: NodeRoute;
    network: "tcp" | "udp";
    latency: number;
    path: string;
    firstHop: string;
  };
  const cands: Cand[] = [];
  for (const route of expandTransportCollections(pool)) {
    const path = nodeRoutePathKey(route);
    const firstHop = (route.hops?.[0]?.ip || path.split("->")[0] || "").trim();
    cands.push({
      route,
      network: routeTransportOf(route),
      latency: routeLatencyMs(route),
      path,
      firstHop,
    });
  }

  const better = (a: Cand, b: Cand) => {
    if (a.latency !== b.latency) return a.latency < b.latency;
    if (a.network !== b.network) return a.network === "udp";
    return a.path < b.path;
  };

  const byPath = new Map<string, Cand>();
  for (const c of cands) {
    const key = c.path || nodeRouteSlotKey(c.route);
    const prev = byPath.get(key);
    if (!prev || better(c, prev)) {
      byPath.set(key, c);
    }
  }
  const winners = [...byPath.values()].sort((a, b) => (better(a, b) ? -1 : 1));

  const out: NodeRoute[] = [];
  const usedPath = new Set<string>();
  const usedHop = new Set<string>();
  for (const c of winners) {
    if (out.length >= MAX_ROUTE_SLOTS * 2) break;
    if (c.path && usedPath.has(c.path)) continue;
    if (c.firstHop && usedHop.has(c.firstHop)) continue;
    if (c.path) usedPath.add(c.path);
    if (c.firstHop) usedHop.add(c.firstHop);
    out.push(tagRouteNetwork(c.route, c.network));
  }
  return out;
}

/**
 * Like combineAndRankRoutes but keeps Route 1..N path order sticky unless a
 * challenger is clearly better (~1% and ≥5ms). Avoids chart label swaps on noise.
 */
export function stickyCombineAndRankRoutes(
  pool: NodeRoute[],
  cap: number,
  stickyKey: string
): NodeRoute[] {
  const requested = Math.max(1, Math.round(cap) || 1);
  const limit =
    requested > MAX_ROUTE_SLOTS
      ? Math.min(requested, MAX_ROUTE_SLOTS * 8)
      : Math.min(MAX_ROUTE_SLOTS, requested);
  const ranked = rankUniqueEdgeRoutes(pool);
  if (!ranked.length) {
    stickyRouteOrderByKey.set(stickyKey, []);
    return [];
  }

  const byPath = new Map<string, NodeRoute>();
  for (const route of ranked) {
    const key = nodeRoutePathKey(route);
    if (key) {
      byPath.set(key, route);
    }
  }

  const prev = (stickyRouteOrderByKey.get(stickyKey) ?? []).filter((key) =>
    byPath.has(key)
  );
  let available = [...ranked];
  const order: string[] = [];

  for (let slot = 0; slot < limit && available.length > 0; slot++) {
    const prevPath = prev[slot];
    const incumbent = prevPath ? byPath.get(prevPath) : undefined;
    const bestAvail = available[0];
    const bestPath = nodeRoutePathKey(bestAvail);
    const incumbentStillAvailable =
      !!incumbent &&
      !!prevPath &&
      available.some((route) => nodeRoutePathKey(route) === prevPath);

    if (
      incumbent &&
      incumbentStillAvailable &&
      prevPath &&
      (bestPath === prevPath ||
        !isClearlyBetterLatency(
          routeLatencyMs(bestAvail),
          routeLatencyMs(incumbent)
        ))
    ) {
      order.push(prevPath);
      available = available.filter(
        (route) => nodeRoutePathKey(route) !== prevPath
      );
      continue;
    }

    if (bestPath) {
      order.push(bestPath);
      available = available.filter(
        (route) => nodeRoutePathKey(route) !== bestPath
      );
    }
  }

  stickyRouteOrderByKey.set(stickyKey, order);
  return order
    .map((path) => byPath.get(path))
    .filter((route): route is NodeRoute => !!route);
}

export function routeTransportOf(route: NodeRoute): "tcp" | "udp" {
  if (route.tcp_available && !route.udp_available) {
    return "tcp";
  }
  if (route.udp_available && !route.tcp_available) {
    return "udp";
  }
  // Dual-capable or unknown — prefer UDP label only when TCP was explicitly off.
  if (route.tcp_available && route.udp_available === false) {
    return "tcp";
  }
  return "udp";
}
