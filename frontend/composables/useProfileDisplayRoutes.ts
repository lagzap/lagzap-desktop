import { computed, type MaybeRef, toValue } from "vue";
import type { Profile, NodeRoute, RelayRoute } from "~/bindings/github.com/lagzap/zap/data";
import { RoutingMode } from "~/bindings/github.com/lagzap/zap/data";
import { ProfileFlag } from "~/constants/profile";
import type { Connection } from "~/types/monitoring";

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
    const latencyA = a.ping_min_latency || a.ping_avg_latency || Infinity;
    const latencyB = b.ping_min_latency || b.ping_avg_latency || Infinity;
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
    return selectedCities.includes(node.name);
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

export function routeDisplayName(
  route: NodeRoute,
  nodes: Record<string, any>,
  localized: (value: any) => string
): string {
  const firstHop = route.hops?.[0];
  if (!firstHop?.ip) {
    return "Route";
  }

  const hopNode = Object.values(nodes).find(
    (node) => node.ipv4 === firstHop.ip || node.ipv6 === firstHop.ip
  );

  if (hopNode?.city) {
    return localized(hopNode.city) as string;
  }

  return firstHop.ip;
}

function findBestRelayRoute(
  matchingNodes: any[],
  routes: Record<string, RelayRoute>
): RelayRoute | null {
  let bestRelayRoute: RelayRoute | null = null;
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
        bestRelayRoute = routeData;
      }
    }
  }

  return bestRelayRoute;
}

export function useProfileDisplayRoutes(profile: MaybeRef<Profile>) {
  const store = useStore();
  const { connections } = useMonitoringStore();

  const profileRef = computed(() => toValue(profile));
  const profileState = computed(
    () => store.profileStates[profileRef.value?.id ?? ""] ?? null
  );

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

    const udpConnections = profileState.value.udp_connections || 0;
    const tcpConnections = profileState.value.tcp_connections || 0;
    return Math.min(MAX_ROUTE_SLOTS, udpConnections + tcpConnections);
  });

  const interfaceCount = computed(() => {
    const selected = profileState.value?.network_interfaces?.length ?? 0;
    return selected > 0 ? selected : 1;
  });

  const numberOfRoutes = computed(
    () => routeSlotCount.value * interfaceCount.value
  );

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

  const bestRelayRoute = computed(() => {
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

  const displayRoutes = computed<NodeRoute[]>(() => {
    if (!bestRelayRoute.value?.routes || numberOfRoutes.value <= 0) {
      return [];
    }

    const routesArray = [...bestRelayRoute.value.routes] as NodeRoute[];
    routesArray.sort((a, b) => {
      const latencyA = a.min_latency || Infinity;
      const latencyB = b.min_latency || Infinity;
      return latencyA - latencyB;
    });

    return routesArray.slice(0, numberOfRoutes.value);
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

    return profileInterfaces.value.map((name, index) => {
      const routes = displayRoutes.value.slice(
        index * slots,
        index * slots + slots
      );
      return {
        index,
        name,
        routes,
        bestRoute: routes[0] ?? null,
      };
    });
  });

  const diagramRoutes = computed<NodeRoute[]>(() => {
    return interfaceRouteGroups.value[0]?.routes ?? [];
  });

  const routeSeries = computed(() => {
    const slots = routeSlotCount.value;
    if (slots <= 0) {
      return [];
    }

    return interfaceRouteGroups.value.flatMap((group) =>
      group.routes.map((route, slotIndex) => {
        const globalIndex = group.index * slots + slotIndex;
        const routeNumber = globalIndex + 1;
        const label = group.name
          ? `Route ${routeNumber} (${group.name})`
          : `Route ${routeNumber}`;

        return {
          index: globalIndex,
          route,
          key: `route-${routeNumber}`,
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
    bestRelayRoute,
    displayRoutes,
    diagramRoutes,
    profileInterfaces,
    interfaceRouteGroups,
    routeSeries,
  };
}
