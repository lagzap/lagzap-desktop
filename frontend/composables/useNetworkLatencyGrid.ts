import type { Node, NodeRoute, RelayRoute } from "~/bindings/github.com/lagzap/zap/data";
import { NodeFlag } from "~/bindings/github.com/lagzap/zap/data";
import type { RouteProbeEvent, RouteProbeSlotMetric } from "~/types/monitoring";
import {
  buildIfaceEntryRttIndex,
  buildNodeIpIndex,
  isPlausibleEntryRttMs,
  isPlausibleProbeForRoute,
  lookupIfaceEntryRttMs,
  nodeIdForHopIp,
  nodeRoutePathKey,
  routeHopFloorMs,
  routeRelayLatency,
  type IfaceEntryRttIndex,
  type NodeIpIndex,
} from "~/composables/useProfileDisplayRoutes";

export type LatencyStackFilter = "all" | "ipv4" | "ipv6";
export type LatencyTransportFilter = "all" | "udp" | "tcp";
export type LatencyInterfaceFilter = "best" | string;

export interface FilteredLatency {
  latencyMs: number | null;
  routeTag: string;
  relayRoute: RelayRoute | null;
}

export interface NodeRouteTableRow {
  key: string;
  routeTag: string;
  variant: string;
  stack: string;
  transport: string;
  path: string;
  latencyMs: number | null;
  liveProbeMs: number | null;
  avgLatency: number;
  packetLoss: number;
  score: number;
  icmp: boolean;
  tcp: boolean;
  udp: boolean;
  available: boolean;
}

type LatencyLookupCtx = {
  entryRtt: Record<string, number>;
  entryIndex: IfaceEntryRttIndex;
  nodeIndex: NodeIpIndex;
  ifaces: string[];
};

function buildRouteVariants(
  stack: LatencyStackFilter,
  transport: LatencyTransportFilter
): string[] {
  const stacks = stack === "all" ? ["ipv4", "ipv6"] : [stack];
  const transports = transport === "all" ? ["udp", "tcp"] : [transport];
  return stacks.flatMap((stackName) =>
    transports.map((transportName) => `${stackName}-${transportName}`)
  );
}

function slotMatchesTransport(
  slot: RouteProbeSlotMetric,
  transport: LatencyTransportFilter
): boolean {
  if (transport === "all") {
    return true;
  }
  return !slot.network || slot.network === transport;
}

function slotMatchesInterface(
  slot: RouteProbeSlotMetric,
  iface: LatencyInterfaceFilter
): boolean {
  if (iface === "best") {
    return true;
  }
  if (!slot.iface) {
    return false;
  }
  return slot.iface.trim().toLowerCase() === String(iface).trim().toLowerCase();
}

/** Card/table latency — same rules as the routes dialog (never raw min alone). */
function routeDisplayLatencyMs(route: NodeRoute | null | undefined): number | null {
  if (!route) {
    return null;
  }
  const ms = routeRelayLatency(route);
  if (!isPlausibleEntryRttMs(ms)) {
    return null;
  }
  // Reject impossible EU-sub-20ms stamps from bad hop sums / wrong NIC merge.
  if (!isPlausibleProbeForRoute(ms, route)) {
    const floor = routeHopFloorMs(route);
    if (isPlausibleEntryRttMs(floor)) {
      return Math.round(floor);
    }
    return null;
  }
  return Math.round(ms);
}

/**
 * Rebuild E2E latency for a named NIC:
 * 1) hop0 = that NIC's user→edge RTT + shared matrix downstream (preferred)
 * 2) else live/optimize E2E keyed by relay id (never added to matrix again)
 *
 * Live E2E must not be treated as hop0 — that paints one session onto every
 * NIC filter and double-counts multi-hop paths.
 */
function routeLatencyForInterface(
  route: NodeRoute | null | undefined,
  iface: string,
  entryRtt: Record<string, number>,
  transport: "tcp" | "udp" | "all",
  nodes: Record<string, { id?: string; ipv4?: string; ipv6?: string } | null | undefined>,
  relayNodeId?: string,
  ctx?: LatencyLookupCtx | null
): number | null {
  if (!route || !iface) {
    return null;
  }
  const hops = route.hops ?? [];
  const networks: ReadonlyArray<"udp" | "tcp" | "icmp"> =
    transport === "all" ? ["udp", "tcp", "icmp"] : [transport];
  const entryIndex = ctx?.entryIndex;
  const nodeIndex = ctx?.nodeIndex;

  let hop0 = 0;
  const entry = nodeIdForHopIp(nodes, hops[0]?.ip, nodeIndex);
  if (entry?.nodeId) {
    const sample = lookupIfaceEntryRttMs(
      entryRtt,
      iface,
      entry.nodeId,
      entry.ipVersion,
      networks,
      entryIndex
    );
    // Never treat path-matrix stubs as client→entry RTT.
    if (isPlausibleEntryRttMs(sample)) {
      hop0 = sample;
    }
  }

  const rest = hops
    .slice(1)
    .reduce((sum, hop) => {
      const ms = hop.latency ?? 0;
      return sum + (ms > 0 ? ms : 0);
    }, 0);
  const measured = Number(route.avg_latency || route.min_latency || 0);
  const measuredOk =
    isPlausibleEntryRttMs(measured) && (hop0 <= 0 || measured >= hop0 + 15);

  if (hop0 > 0) {
    // Direct path: hop0 is client→this node.
    if (hops.length <= 1) {
      // Prefer optimize E2E when hop0 was poisoned with a nearer entry's RTT.
      if (measuredOk) {
        return Math.round(measured);
      }
      return Math.round(hop0);
    }

    // Multi-hop: hop0 is only client→entry. Never show it alone as city ping
    // (that painted Tehran's ~33ms onto every EU card).
    if (rest > 0) {
      const total = hop0 + rest;
      if (!isPlausibleProbeForRoute(total, route, rest)) {
        return Math.round(Math.max(total, hop0));
      }
      return Math.round(total);
    }

    if (measuredOk) {
      return Math.round(measured);
    }
  }

  // No usable hop0+matrix — fall back to relay-keyed E2E for this NIC only.
  if (relayNodeId) {
    const e2e = lookupIfaceEntryRttMs(
      entryRtt,
      iface,
      relayNodeId,
      "all",
      networks,
      entryIndex
    );
    // Reject entry-RTT copies written under the relay id (same ~hop0 value).
    if (
      isPlausibleEntryRttMs(e2e) &&
      !(hop0 > 0 && hops.length > 1 && e2e < hop0 + 15)
    ) {
      return Math.round(e2e);
    }
  }

  if (measuredOk) {
    return Math.round(measured);
  }
  return null;
}

/** Probe events are keyed by node id and/or node-ipv4-udp — resolve both. */
function resolveProbeEventsForNode(
  history: Record<string, RouteProbeEvent[]>,
  nodeId: string,
  variant?: string
): RouteProbeEvent[] {
  if (!nodeId) {
    return [];
  }
  const candidates = variant
    ? [
        `${nodeId}-${variant}`,
        nodeId,
        `${nodeId}-ipv4-udp`,
        `${nodeId}-ipv4-tcp`,
        `${nodeId}-ipv6-udp`,
        `${nodeId}-ipv6-tcp`,
      ]
    : [
        nodeId,
        `${nodeId}-ipv4-udp`,
        `${nodeId}-ipv4-tcp`,
        `${nodeId}-ipv6-udp`,
        `${nodeId}-ipv6-tcp`,
      ];
  for (const key of candidates) {
    const events = history[key];
    if (events?.length) {
      return events;
    }
  }
  for (const [key, events] of Object.entries(history)) {
    if (!events?.length) {
      continue;
    }
    if (key === nodeId || key.startsWith(`${nodeId}-`)) {
      return events;
    }
  }
  return [];
}

export function useNetworkLatencyGrid() {
  const store = useStore();
  const { routeProbeHistory, probedInterfaceNames } = useMonitoringStore();
  const { getNodeLabelByIp } = useNodeLocationLabel();

  const stackFilter = ref<LatencyStackFilter>("all");
  const transportFilter = ref<LatencyTransportFilter>("all");
  const interfaceFilter = ref<LatencyInterfaceFilter>("best");

  const routeVariants = computed(() =>
    buildRouteVariants(stackFilter.value, transportFilter.value)
  );

  function makeLatencyLookupCtx(): LatencyLookupCtx {
    const entryRtt = store.ifaceEntryRtt ?? {};
    const entryIndex = buildIfaceEntryRttIndex(entryRtt);
    const nodeIndex = buildNodeIpIndex(store.nodes ?? {});
    const ifaces = [
      ...new Set([
        ...(probedInterfaceNames.value ?? []),
        ...entryIndex.ifaces,
      ]),
    ];
    return { entryRtt, entryIndex, nodeIndex, ifaces };
  }

  function hasRelayFlag(node: Node): boolean {
    return (node.flags & NodeFlag.NodeFlag_NODE_FLAG_RELAY) !== 0;
  }

  function regionHasRelayServers(regionTag: string): boolean {
    return Object.values(store.nodes).some(
      (node) => hasRelayFlag(node) && node.region === regionTag
    );
  }

  const visibleRegions = computed(() =>
    Object.values(store.regions).filter((region) =>
      regionHasRelayServers(region.tag)
    )
  );

  function considerLatency(
    currentBest: FilteredLatency,
    latency: number,
    routeTag: string,
    relayRoute: RelayRoute | null
  ): FilteredLatency {
    if (
      typeof latency !== "number" ||
      Number.isNaN(latency) ||
      latency <= 0
    ) {
      return currentBest;
    }

    if (currentBest.latencyMs != null && latency >= currentBest.latencyMs) {
      return currentBest;
    }

    return {
      latencyMs: Math.round(latency),
      routeTag,
      relayRoute,
    };
  }

  function getFilteredLatencyForNode(
    nodeId: string,
    ctx?: LatencyLookupCtx | null
  ): FilteredLatency {
    let best: FilteredLatency = {
      latencyMs: null,
      routeTag: nodeId,
      relayRoute: null,
    };
    const namedIface =
      interfaceFilter.value !== "best" ? interfaceFilter.value : "";
    const lookup = ctx ?? makeLatencyLookupCtx();
    const { entryRtt, ifaces } = lookup;
    let usedProbedOrIfaceSample = false;

    for (const variant of routeVariants.value) {
      const routeTag = `${nodeId}-${variant}`;
      const routeData = store.routes[routeTag];
      const transport = variant.endsWith("tcp")
        ? ("tcp" as const)
        : ("udp" as const);

      // Live probes (iface-tagged) — primary source of truth for the selector.
      const probeEvents = resolveProbeEventsForNode(
        routeProbeHistory.value,
        nodeId,
        variant
      );
      if (probeEvents.length) {
        const latest = probeEvents[probeEvents.length - 1];
        for (const slot of latest.slots ?? []) {
          if (!(slot.latency > 0) || (slot.packet_loss ?? 0) >= 100) {
            continue;
          }
          if (!slotMatchesTransport(slot, transportFilter.value)) {
            continue;
          }
          if (!slotMatchesInterface(slot, interfaceFilter.value)) {
            continue;
          }
          const pathRoute =
            routeData?.routes?.find(
              (route) => route && nodeRoutePathKey(route) === slot.path_key
            ) ??
            routeData?.routes?.[0] ??
            null;
          // Matrix floor only (not shared hop0 from another NIC).
          const matrixFloor = (pathRoute?.hops ?? [])
            .slice(1)
            .reduce((sum, hop) => sum + (hop.latency || 0), 0);
          if (
            pathRoute &&
            !isPlausibleProbeForRoute(slot.latency, pathRoute, matrixFloor)
          ) {
            continue;
          }
          if (!isPlausibleEntryRttMs(slot.latency)) {
            continue;
          }
          usedProbedOrIfaceSample = true;
          best = considerLatency(best, slot.latency, routeTag, routeData);
        }
      }

      if (!routeData?.routes?.length) {
        continue;
      }

      for (const route of routeData.routes) {
        if ((route.packet_loss ?? 0) >= 100) {
          continue;
        }
        if (namedIface) {
          // Named NIC: only that NIC's entry RTT — never shared optimize avg.
          const latency = routeLatencyForInterface(
            route,
            namedIface,
            entryRtt,
            transportFilter.value === "all" ? "all" : transport,
            store.nodes ?? {},
            nodeId,
            lookup
          );
          if (latency == null || !isPlausibleEntryRttMs(latency)) {
            continue;
          }
          usedProbedOrIfaceSample = true;
          best = considerLatency(best, latency, routeTag, routeData);
          continue;
        }

        // Best Internet: rebuild per known NIC from ifaceEntryRtt / probed names,
        // then take the winner — do not stamp shared relayRoutes avg.
        for (const iface of ifaces) {
          const latency = routeLatencyForInterface(
            route,
            iface,
            entryRtt,
            transportFilter.value === "all" ? "all" : transport,
            store.nodes ?? {},
            nodeId,
            lookup
          );
          if (latency == null || !isPlausibleEntryRttMs(latency)) {
            continue;
          }
          usedProbedOrIfaceSample = true;
          best = considerLatency(best, latency, routeTag, routeData);
        }
      }
    }

    // Cold start only: no per-iface probe/entry samples yet.
    if (!usedProbedOrIfaceSample && !namedIface) {
      for (const variant of routeVariants.value) {
        const routeTag = `${nodeId}-${variant}`;
        const routeData = store.routes[routeTag];
        if (!routeData?.routes?.length) {
          continue;
        }
        for (const route of routeData.routes) {
          const latency = routeDisplayLatencyMs(route);
          if (latency == null) {
            continue;
          }
          best = considerLatency(best, latency, routeTag, routeData);
        }
      }
    }

    if (best.relayRoute == null && best.routeTag.includes("-")) {
      best.relayRoute = store.routes[best.routeTag] ?? null;
    }

    return best;
  }

  function getFilteredLatencyForNodes(
    nodes: Node[],
    ctx?: LatencyLookupCtx | null
  ): FilteredLatency {
    let best: FilteredLatency = {
      latencyMs: null,
      routeTag: "",
      relayRoute: null,
    };
    const lookup = ctx ?? makeLatencyLookupCtx();

    for (const node of nodes) {
      if (!hasRelayFlag(node)) {
        continue;
      }
      const nodeBest = getFilteredLatencyForNode(node.id, lookup);
      if (nodeBest.latencyMs == null) {
        continue;
      }
      if (best.latencyMs == null || nodeBest.latencyMs < best.latencyMs) {
        best = nodeBest;
      }
    }

    if (!best.routeTag && nodes.length > 0) {
      best.routeTag = nodes.find(hasRelayFlag)?.id ?? nodes[0].id;
    }

    return best;
  }

  function getFilteredLatencyForRegion(
    regionTag: string,
    areasByRegion: Record<string, Record<string, Node[]>>,
    ctx?: LatencyLookupCtx | null
  ): FilteredLatency {
    const regionAreas = areasByRegion[regionTag] ?? {};
    const nodes: Node[] = [];
    Object.values(regionAreas).forEach((areaNodes) => nodes.push(...areaNodes));
    return getFilteredLatencyForNodes(nodes, ctx);
  }

  /** One shared index pass — use from page computeds to avoid N rebuilds. */
  function getAllRelayNodeLatencies(): Record<string, FilteredLatency> {
    const lookup = makeLatencyLookupCtx();
    const result: Record<string, FilteredLatency> = {};
    for (const node of Object.values(store.nodes)) {
      if (hasRelayFlag(node)) {
        result[node.id] = getFilteredLatencyForNode(node.id, lookup);
      }
    }
    return result;
  }

  function bestLatencyFromNodes(
    nodes: Node[],
    byId: Record<string, FilteredLatency>
  ): FilteredLatency {
    let best: FilteredLatency = {
      latencyMs: null,
      routeTag: "",
      relayRoute: null,
    };
    for (const node of nodes) {
      if (!hasRelayFlag(node)) {
        continue;
      }
      const nodeBest = byId[node.id];
      if (!nodeBest || nodeBest.latencyMs == null) {
        continue;
      }
      if (best.latencyMs == null || nodeBest.latencyMs < best.latencyMs) {
        best = nodeBest;
      }
    }
    if (!best.routeTag && nodes.length > 0) {
      best.routeTag = nodes.find(hasRelayFlag)?.id ?? nodes[0].id;
    }
    return best;
  }

  function formatRoutePath(route: NodeRoute): string {
    const hops = route.hops ?? [];
    if (hops.length === 0) {
      return "—";
    }

    return hops
      .map((hop) => {
        const ip = hop.ip ?? "";
        const label = getNodeLabelByIp(ip);
        if (label !== "Server") {
          return label;
        }
        return ip || "—";
      })
      .join(" → ");
  }

  function latestProbeSlots(nodeId: string, variant: string): RouteProbeSlotMetric[] {
    const events = resolveProbeEventsForNode(
      routeProbeHistory.value,
      nodeId,
      variant
    );
    if (!events.length) {
      return [];
    }
    return events[events.length - 1].slots ?? [];
  }

  function probeForRoute(
    slots: RouteProbeSlotMetric[],
    pathKey: string,
    transport: LatencyTransportFilter
  ): RouteProbeSlotMetric | null {
    let best: RouteProbeSlotMetric | null = null;

    for (const slot of slots) {
      if (!(slot.latency > 0) || (slot.packet_loss ?? 0) >= 100) {
        continue;
      }
      if (slot.path_key && slot.path_key !== pathKey) {
        continue;
      }
      if (!slotMatchesTransport(slot, transport)) {
        continue;
      }
      if (!slotMatchesInterface(slot, interfaceFilter.value)) {
        continue;
      }
      if (!best || slot.latency < best.latency) {
        best = slot;
      }
    }

    return best;
  }

  function routeIsAvailable(
    route: NodeRoute,
    transport: LatencyTransportFilter,
    latencyMs: number | null,
    liveProbeMs: number | null
  ): boolean {
    const hasLatency =
      (latencyMs != null && latencyMs > 0) ||
      (liveProbeMs != null && liveProbeMs > 0);

    if (!hasLatency) {
      return false;
    }

    if (transport === "tcp") {
      return !!route.tcp_available;
    }
    if (transport === "udp") {
      return !!route.udp_available;
    }

    return !!(route.icmp_available || route.tcp_available || route.udp_available);
  }

  function getNodeRouteTableRows(nodeId: string): NodeRouteTableRow[] {
    const rows: NodeRouteTableRow[] = [];
    const namedIface =
      interfaceFilter.value !== "best" ? interfaceFilter.value : "";
    const lookup = makeLatencyLookupCtx();
    const { entryRtt, ifaces } = lookup;

    for (const variant of routeVariants.value) {
      const routeTag = `${nodeId}-${variant}`;
      const relayRoute = store.routes[routeTag];
      if (!relayRoute?.routes?.length) {
        continue;
      }

      const stack = variant.startsWith("ipv6") ? "IPv6" : "IPv4";
      const transport = variant.endsWith("tcp") ? "TCP" : "UDP";
      const transportFilterValue =
        transport === "TCP" ? ("tcp" as const) : ("udp" as const);
      const probeSlots = latestProbeSlots(nodeId, variant);

      relayRoute.routes.forEach((route, index) => {
        if (!route || (route.packet_loss ?? 0) >= 100) {
          return;
        }

        const pathKey = nodeRoutePathKey(route);
        const matrixFloor = (route.hops ?? [])
          .slice(1)
          .reduce((sum, hop) => sum + (hop.latency || 0), 0);
        const probe = probeForRoute(probeSlots, pathKey, transportFilterValue);
        const liveProbeMs =
          probe &&
          probe.latency > 0 &&
          isPlausibleProbeForRoute(probe.latency, route, matrixFloor)
            ? Math.round(probe.latency)
            : null;

        let latencyFromIface: number | null = null;
        if (namedIface) {
          latencyFromIface = routeLatencyForInterface(
            route,
            namedIface,
            entryRtt,
            transportFilterValue,
            store.nodes ?? {},
            nodeId,
            lookup
          );
        } else {
          // Best: prefer per-NIC rebuilt samples; shared avg only if none exist.
          for (const iface of ifaces) {
            const sample = routeLatencyForInterface(
              route,
              iface,
              entryRtt,
              transportFilterValue,
              store.nodes ?? {},
              nodeId,
              lookup
            );
            if (sample == null) {
              continue;
            }
            if (latencyFromIface == null || sample < latencyFromIface) {
              latencyFromIface = sample;
            }
          }
          if (latencyFromIface == null && liveProbeMs == null) {
            latencyFromIface = routeDisplayLatencyMs(route);
          }
        }

        // Prefer live probe for this selector — shared route hops may lag / mix NICs.
        const latencyMs = liveProbeMs ?? latencyFromIface;
        const packetLoss =
          probe != null
            ? probe.packet_loss ?? 0
            : namedIface
              ? 0
              : route.packet_loss ?? 0;
        const score =
          probe != null && (probe.score ?? 0) > 0
            ? probe.score ?? 0
            : namedIface
              ? 0
              : route.score ?? 0;

        rows.push({
          key: `${routeTag}-${index}-${pathKey || index}`,
          routeTag,
          variant,
          stack,
          transport,
          path: formatRoutePath(route),
          latencyMs,
          liveProbeMs,
          avgLatency: Math.round(latencyMs || 0),
          packetLoss,
          score,
          icmp: !!route.icmp_available,
          tcp: !!route.tcp_available,
          udp: !!route.udp_available,
          available: routeIsAvailable(
            route,
            transportFilter.value,
            latencyMs,
            liveProbeMs
          ),
        });
      });
    }

    return rows.sort(
      (a, b) =>
        (a.latencyMs ?? Number.MAX_SAFE_INTEGER) -
        (b.latencyMs ?? Number.MAX_SAFE_INTEGER)
    );
  }

  return {
    stackFilter,
    transportFilter,
    interfaceFilter,
    visibleRegions,
    hasRelayFlag,
    regionHasRelayServers,
    getFilteredLatencyForNode,
    getFilteredLatencyForNodes,
    getFilteredLatencyForRegion,
    getAllRelayNodeLatencies,
    bestLatencyFromNodes,
    getNodeRouteTableRows,
  };
}
