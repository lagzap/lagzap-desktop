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
} from "~/types/monitoring";

const MAX_LOGS = 1000;
const MAX_SPEED_HISTORY = SPEED_HISTORY_SECONDS;
const MAX_ROUTE_PING_HISTORY = SPEED_HISTORY_SECONDS * 2;

const MAX_LAG_FIX_HISTORY = 200;

let connectionsStore: ReturnType<typeof createMonitoringStore> | null = null;

function createMonitoringStore() {
  let logs: Ref<Log[]> = ref([]);
  let connections: Ref<Connection[]> = ref([]);
  let routes: Ref<RouteMonitoringStatus | null> = ref(null);
  let networkTraffic: Ref<NetworkTraffic | null> = ref(null);
  let networkSpeedHistory: Ref<NetworkSpeedPoint[]> = ref([]);
  let routePingHistory: Ref<Record<string, RouteMetricEvent[]>> = ref({});
  let routeProbeHistory: Ref<Record<string, RouteProbeEvent[]>> = ref({});
  let lagFixHistory: Ref<LagFixEvent[]> = ref([]);
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
        logs.value = logs.value.slice(0, MAX_LOGS);
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
    const history = routeProbeHistory.value[tag] ?? [];
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
      return;
    }
    lagFixHistory.value = [...lagFixHistory.value, fix].slice(-MAX_LAG_FIX_HISTORY);
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
    lagFixHistory: computed(() => lagFixHistory.value),
    lagFixStats: computed(() => lagFixStats.value),
    resetNetworkSpeedHistory: () => {
      networkSpeedHistory.value = [];
      networkTraffic.value = null;
    },
    resetRoutePingHistory: () => {
      routePingHistory.value = {};
      routeProbeHistory.value = {};
      lagFixHistory.value = [];
    },
  };
}

export function useMonitoringStore() {
  if (!connectionsStore) {
    connectionsStore = createMonitoringStore();
  }
  return connectionsStore;
}
