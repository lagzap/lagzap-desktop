import { Events } from "@wailsio/runtime";
import type { Connection } from "~/types/monitoring";

let connectionsStore: ReturnType<typeof createMonitoringStore> | null = null;

function createMonitoringStore(closed: boolean) {
  let connections: Ref<Connection[]> = ref([]);
  let closedConnections: Ref<Connection[]> = ref([]);

  Events.On("connections", ({ data }: any) => {
    connections.value = data[0] as Connection[];
  });
  if (closed) {
    Events.On("closed-connections", ({ data }: any) => {
      closedConnections.value = data[0] as Connection[];
    });
  }

  return { connections, closedConnections };
}

export function useMonitoringStore(closed: boolean = false) {
  if (!connectionsStore) {
    connectionsStore = createMonitoringStore(closed);
  }
  return connectionsStore;
}
