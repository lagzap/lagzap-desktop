import { Events } from "@wailsio/runtime";
import type { Log, Connection } from "~/types/monitoring";

let connectionsStore: ReturnType<typeof createMonitoringStore> | null = null;

function createMonitoringStore() {
  let logs: Ref<Log[]> = ref([]);
  let connections: Ref<Connection[]> = ref([]);
  let closedConnections: Ref<Connection[]> = ref([]);

  Events.On("log", ({ data }: any) => {
    logs.value.unshift(data[0] as Log);
  });
  Events.On("connections", ({ data }: any) => {
    connections.value = data[0] as Connection[];
  });
  Events.On("closed-connections", ({ data }: any) => {
    closedConnections.value = data[0] as Connection[];
  });

  return { logs, connections, closedConnections };
}

export function useMonitoringStore() {
  if (!connectionsStore) {
    connectionsStore = createMonitoringStore();
  }
  return connectionsStore;
}
