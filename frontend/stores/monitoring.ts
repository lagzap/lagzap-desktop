import { Events } from "@wailsio/runtime";
import type { Log, Connection } from "~/types/monitoring";

const MAX_LOGS = 100;

let connectionsStore: ReturnType<typeof createMonitoringStore> | null = null;

function createMonitoringStore() {
  let logs: Ref<Log[]> = ref([]);
  let connections: Ref<Connection[]> = ref([]);
  Events.On("log", ({ data }: any) => {
    if (data && Array.isArray(data)) {
      logs.value.unshift(data[0] as Log);
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
  return {
    logs: computed(() => logs.value),
    connections: computed(() => connections.value),
  };
}

export function useMonitoringStore() {
  if (!connectionsStore) {
    connectionsStore = createMonitoringStore();
  }
  return connectionsStore;
}
