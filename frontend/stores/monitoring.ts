import { Events } from "@wailsio/runtime";
import { SPEED_HISTORY_SECONDS } from "~/composables/useLatencyMetrics";
import type {
  Log,
  Connection,
  RouteMonitoringStatus,
  NetworkTraffic,
  NetworkSpeedPoint,
  RouteMetricEvent,
  RouteProbeEvent,
  LagFixEvent,
  LagFixStats,
  RelayPathEvent,
} from "~/types/monitoring";
import {
  lagFixToHistoryEvent,
  putNetworkHistoryEvent,
  putNetworkHistoryEvents,
  relayPathToHistoryEvent,
} from "~/utils/networkHistoryDB";
import { isNetworkHistoryConsentGranted } from "~/utils/networkHistoryConsent";
import { useStore } from "~/stores";

function canPersistNetworkHistory(): boolean {
  try {
    const store = useStore();
    return (
      store.abilities.includes("admin") && isNetworkHistoryConsentGranted()
    );
  } catch {
    return false;
  }
}

function persistHistoryEvent(
  promise: Promise<unknown>
): void {
  if (!canPersistNetworkHistory()) {
    return;
  }
  void promise.catch(() => undefined);
}

function historyNodesContext(): {
  nodes: Record<string, any> | null;
  localizeCity: (city: unknown) => string;
} {
  try {
    const store = useStore();
    return {
      nodes: store.nodes ?? null,
      localizeCity: (city) => {
        try {
          if (!city || typeof city !== "object") {
            return "";
          }
          return (store.localized(city as Record<string, string>) as string) || "";
        } catch {
          return "";
        }
      },
    };
  } catch {
    return { nodes: null, localizeCity: () => "" };
  }
}

const MAX_LOGS = 1000;
const MAX_SPEED_HISTORY = SPEED_HISTORY_SECONDS;
const MAX_ROUTE_PING_HISTORY = 240;

const MAX_LAG_FIX_HISTORY = 200;
const MAX_RELAY_PATH_EVENTS = 300;

let connectionsStore: ReturnType<typeof createMonitoringStore> | null = null;

function createMonitoringStore() {
  let logs: Ref<Log[]> = ref([]);
  let connections: Ref<Connection[]> = ref([]);
  let routes: Ref<RouteMonitoringStatus | null> = ref(null);
  let networkTraffic: Ref<NetworkTraffic | null> = ref(null);
  let networkSpeedHistory: Ref<NetworkSpeedPoint[]> = ref([]);
  let routePingHistory: Ref<Record<string, RouteMetricEvent[]>> = ref({});
  let routeProbeHistory: Ref<Record<string, RouteProbeEvent[]>> = ref({});
  /** Monotonic received count per tag (survives ring-buffer truncation). */
  let routeProbeReceivedCount: Ref<Record<string, number>> = ref({});
  /** NIC names seen on live probes — avoids scanning full probe history. */
  let probedInterfaceNames: Ref<string[]> = ref([]);
  const probedInterfaceNameSet = new Set<string>();
  let lagFixHistory: Ref<LagFixEvent[]> = ref([]);
  let relayPathEvents: Ref<RelayPathEvent[]> = ref([]);
  let lagFixStats: Ref<LagFixStats> = ref({
    verified_count: 0,
    attempt_count: 0,
    failed_count: 0,
    total_improvement_ms: 0,
  });
  
  Events.On("log", ({ data }: any) => {
    if (data) {
      logs.value.push(data as Log);
      if (logs.value.length > MAX_LOGS) {
        logs.value = logs.value.slice(-MAX_LOGS);
      }
    }
  });
  
  Events.On("connections", ({ data }: any) => {
    if (data) {
      connections.value = data as Connection[];
    }
  });
  
  Events.On("routes", ({ data }: any) => {
    if (!data) {
      return;
    }
    routes.value = data as RouteMonitoringStatus;
  });

  Events.On("route-probe", ({ data }: any) => {
    if (!data) {
      return;
    }
    const probe = data as RouteProbeEvent;
    const tag = probe.route_tag;
    if (!tag) {
      return;
    }
    let ifacesChanged = false;
    for (const slot of probe.slots ?? []) {
      if (!slot.iface || !(slot.latency > 0)) {
        continue;
      }
      if (!probedInterfaceNameSet.has(slot.iface)) {
        probedInterfaceNameSet.add(slot.iface);
        ifacesChanged = true;
      }
    }
    if (ifacesChanged) {
      probedInterfaceNames.value = [...probedInterfaceNameSet];
    }
    const history = routeProbeHistory.value[tag] ?? [];
    routeProbeReceivedCount.value = {
      ...routeProbeReceivedCount.value,
      [tag]: (routeProbeReceivedCount.value[tag] ?? 0) + 1,
    };
    routeProbeHistory.value = {
      ...routeProbeHistory.value,
      [tag]: [...history, probe].slice(-MAX_ROUTE_PING_HISTORY),
    };
  });

  Events.On("lag-fix", ({ data }: any) => {
    if (!data) {
      return;
    }
    const fix = data as LagFixEvent;
    const existingIndex = lagFixHistory.value.findIndex((item) => item.id === fix.id);
    if (existingIndex >= 0) {
      const next = [...lagFixHistory.value];
      next[existingIndex] = fix;
      lagFixHistory.value = next;
    } else {
      lagFixHistory.value = [...lagFixHistory.value, fix].slice(-MAX_LAG_FIX_HISTORY);
    }
    const ctx = historyNodesContext();
    persistHistoryEvent(
      putNetworkHistoryEvent(
        lagFixToHistoryEvent(fix, ctx.nodes, ctx.localizeCity)
      )
    );
  });

  Events.On("lag-fix-history", ({ data }: any) => {
    if (!data || !Array.isArray(data)) {
      return;
    }
    const fixes = (data as LagFixEvent[]).slice(-MAX_LAG_FIX_HISTORY);
    lagFixHistory.value = fixes;
    const ctx = historyNodesContext();
    persistHistoryEvent(
      putNetworkHistoryEvents(
        fixes.map((fix) =>
          lagFixToHistoryEvent(fix, ctx.nodes, ctx.localizeCity)
        )
      )
    );
  });

  Events.On("relay-path", ({ data }: any) => {
    if (!data) {
      return;
    }
    const event = data as RelayPathEvent;
    relayPathEvents.value = [...relayPathEvents.value, event].slice(-MAX_RELAY_PATH_EVENTS);
    const ctx = historyNodesContext();
    persistHistoryEvent(
      putNetworkHistoryEvent(
        relayPathToHistoryEvent(event, ctx.nodes, ctx.localizeCity)
      )
    );
  });

  Events.On("lag-fix-stats", ({ data }: any) => {
    if (!data) {
      return;
    }
    lagFixStats.value = data as LagFixStats;
  });

  Events.On("route-metrics", ({ data }: any) => {
    if (!data) {
      return;
    }
    const metric = data as RouteMetricEvent;
    const tag = metric.route_tag;
    if (!tag) {
      return;
    }
    const history = routePingHistory.value[tag] ?? [];
    routePingHistory.value = {
      ...routePingHistory.value,
      [tag]: [...history, metric].slice(-MAX_ROUTE_PING_HISTORY),
    };
  });

  Events.On("network-traffic", ({ data }: any) => {
    if (data) {
      const traffic = data as NetworkTraffic;
      networkTraffic.value = traffic;

      const interfaces = Object.fromEntries(
        (traffic.interfaces ?? []).map((iface) => [
          iface.name,
          {
            upload: iface.upload_speed || 0,
            download: iface.download_speed || 0,
          },
        ])
      );

      networkSpeedHistory.value = [
        ...networkSpeedHistory.value,
        { interfaces },
      ].slice(-MAX_SPEED_HISTORY);
    }
  });
  
  return {
    logs: computed(() => logs.value),
    connections: computed(() => connections.value),
    routes: computed(() => routes.value),
    networkTraffic: computed(() => networkTraffic.value),
    networkSpeedHistory: computed(() => networkSpeedHistory.value),
    routePingHistory: computed(() => routePingHistory.value),
    routeProbeHistory: computed(() => routeProbeHistory.value),
    routeProbeReceivedCount: computed(() => routeProbeReceivedCount.value),
    probedInterfaceNames: computed(() => probedInterfaceNames.value),
    lagFixHistory: computed(() => lagFixHistory.value),
    relayPathEvents: computed(() => relayPathEvents.value),
    lagFixStats: computed(() => lagFixStats.value),
    resetNetworkSpeedHistory: () => {
      networkSpeedHistory.value = [];
      networkTraffic.value = null;
    },
    resetRoutePingHistory: () => {
      routePingHistory.value = {};
      routeProbeHistory.value = {};
      routeProbeReceivedCount.value = {};
      probedInterfaceNameSet.clear();
      probedInterfaceNames.value = [];
      lagFixHistory.value = [];
      relayPathEvents.value = [];
    },
  };
}

export function useMonitoringStore() {
  if (!connectionsStore) {
    connectionsStore = createMonitoringStore();
  }
  return connectionsStore;
}
