import { Events } from "@wailsio/runtime";
import type { Log, Connection, RouteMonitoringStatus } from "~/types/monitoring";

const MAX_LOGS = 1000;

let connectionsStore: ReturnType<typeof createMonitoringStore> | null = null;

function createMonitoringStore() {
  let logs: Ref<Log[]> = ref([]);
  let connections: Ref<Connection[]> = ref([]);
  let routes: Ref<RouteMonitoringStatus | null> = ref(null);
  
  Events.On("log", ({ data }: any) => {
    if (data && Array.isArray(data)) {
      logs.value.push(data[0] as Log);
      if (logs.value.length > MAX_LOGS) {
        logs.value = logs.value.slice(0, MAX_LOGS);
      }
    }
  });
  
  Events.On("connections", ({ data }: any) => {
    if (data && Array.isArray(data)) {
      connections.value = data[0] as Connection[];
    }
  });
  
  Events.On("routes", ({ data }: any) => {
    if (data) {
      routes.value = data[0] as RouteMonitoringStatus;
    }
  });
  
  return {
    logs: computed(() => logs.value),
    connections: computed(() => connections.value),
    routes: computed(() => routes.value),
  };
}

export function useMonitoringStore() {
  if (!connectionsStore) {
    connectionsStore = createMonitoringStore();
  }
  return connectionsStore;
}
