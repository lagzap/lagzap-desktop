import type { Node, NodeRoute, RelayRoute } from "~/bindings/github.com/lagzap/zap/data";
import { NodeFlag } from "~/bindings/github.com/lagzap/zap/data";
import type { RouteProbeSlotMetric } from "~/types/monitoring";
import {
  nodeRoutePathKey,
  routeRelayLatency,
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
  return !!slot.iface && slot.iface === iface;
}

export function useNetworkLatencyGrid() {
  const store = useStore();
  const { routeProbeHistory } = useMonitoringStore();
  const { getNodeLabelByIp } = useNodeLocationLabel();

  const stackFilter = ref<LatencyStackFilter>("all");
  const transportFilter = ref<LatencyTransportFilter>("all");
  const interfaceFilter = ref<LatencyInterfaceFilter>("best");

  const routeVariants = computed(() =>
    buildRouteVariants(stackFilter.value, transportFilter.value)
  );

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

  function getFilteredLatencyForNode(nodeId: string): FilteredLatency {
    let best: FilteredLatency = {
      latencyMs: null,
      routeTag: nodeId,
      relayRoute: null,
    };

    for (const variant of routeVariants.value) {
      const routeTag = `${nodeId}-${variant}`;
      const probeEvents = routeProbeHistory.value[routeTag];
      if (probeEvents?.length) {
        const latest = probeEvents[probeEvents.length - 1];
        for (const slot of latest.slots ?? []) {
          if (slot.latency <= 0) {
            continue;
          }
          if (!slotMatchesTransport(slot, transportFilter.value)) {
            continue;
          }
          if (!slotMatchesInterface(slot, interfaceFilter.value)) {
            continue;
          }
          best = considerLatency(best, slot.latency, routeTag, null);
        }
      }

      if (interfaceFilter.value !== "best") {
        continue;
      }

      const routeData = store.routes[routeTag];
      if (!routeData?.routes?.length) {
        continue;
      }

      for (const route of routeData.routes) {
        const latency = route?.min_latency;
        if (typeof latency !== "number" || latency <= 0) {
          continue;
        }
        best = considerLatency(best, latency, routeTag, routeData);
      }
    }

    if (best.relayRoute == null && best.routeTag.includes("-")) {
      best.relayRoute = store.routes[best.routeTag] ?? null;
    }

    return best;
  }

  function getFilteredLatencyForNodes(nodes: Node[]): FilteredLatency {
    let best: FilteredLatency = {
      latencyMs: null,
      routeTag: "",
      relayRoute: null,
    };

    for (const node of nodes) {
      if (!hasRelayFlag(node)) {
        continue;
      }
      const nodeBest = getFilteredLatencyForNode(node.id);
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
    areasByRegion: Record<string, Record<string, Node[]>>
  ): FilteredLatency {
    const regionAreas = areasByRegion[regionTag] ?? {};
    const nodes: Node[] = [];
    Object.values(regionAreas).forEach((areaNodes) => nodes.push(...areaNodes));
    return getFilteredLatencyForNodes(nodes);
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

  function latestProbeSlots(routeTag: string): RouteProbeSlotMetric[] {
    const events = routeProbeHistory.value[routeTag];
    if (!events?.length) {
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
      if (slot.latency <= 0) {
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
      const probeSlots = latestProbeSlots(routeTag);

      relayRoute.routes.forEach((route, index) => {
        if (!route) {
          return;
        }

        const pathKey = nodeRoutePathKey(route);
        const latencyFromRoute = routeRelayLatency(route) || null;
        const probe = probeForRoute(probeSlots, pathKey, transportFilterValue);
        const liveProbeMs =
          probe && probe.latency > 0 ? Math.round(probe.latency) : null;
        // Prefer this interface's live probe — shared route hops may lag behind.
        const latencyMs = liveProbeMs ?? latencyFromRoute;

        rows.push({
          key: `${routeTag}-${index}-${pathKey || index}`,
          routeTag,
          variant,
          stack,
          transport,
          path: formatRoutePath(route),
          latencyMs,
          liveProbeMs,
          avgLatency: Math.round(route.avg_latency || latencyMs || 0),
          packetLoss: route.packet_loss ?? 0,
          score: route.score ?? 0,
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
    getNodeRouteTableRows,
  };
}
