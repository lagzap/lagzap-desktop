import { Events } from "@wailsio/runtime";
import type {
  Log,
  Connection,
  RouteMonitoringStatus,
  RouteProbeEvent,
} from "~/types/monitoring";

const MAX_LOGS = 1000;
const MAX_ROUTE_PING_HISTORY = 240;


/** Normalize connection list from Wails events (v3: data is the list). */
function asConnectionList(data: unknown): Connection[] {
  if (data == null) {
    return [];
  }
  if (Array.isArray(data)) {
    // Rare nested emit: [[...conns]]
    if (data.length === 1 && Array.isArray(data[0])) {
      return data[0] as Connection[];
    }
    return data as Connection[];
  }
  if (typeof data === "object") {
    return [data as Connection];
  }
  return [];
}

/** Cheap stability check — skip reactive writes when nothing meaningful moved. */
function connectionsFingerprint(list: Connection[]): string {
  if (!list.length) {
    return "";
  }
  return list
    .map(
      (c) =>
        `${c.id}:${c.download_speed ?? 0}:${c.upload_speed ?? 0}:${Math.round(c.avg_latency ?? 0)}:${c.node_id ?? ""}`
    )
    .join("|");
}

/** Unwrap object payloads only — never flatten a 1-item connection list. */
function unwrapEventPayload(data: unknown): unknown {
  if (
    Array.isArray(data) &&
    data.length === 1 &&
    data[0] &&
    typeof data[0] === "object" &&
    !Array.isArray(data[0])
  ) {
    return data[0];
  }
  return data;
}

let connectionsStore: ReturnType<typeof createMonitoringStore> | null = null;

function createMonitoringStore() {
  let logs: Ref<Log[]> = ref([]);
  let connections: Ref<Connection[]> = ref([]);
  let routes: Ref<RouteMonitoringStatus | null> = ref(null);
  let routeProbeHistory: Ref<Record<string, RouteProbeEvent[]>> = ref({});
  /** NIC names seen on live probes — avoids scanning full probe history. */
  let probedInterfaceNames: Ref<string[]> = ref([]);
  const probedInterfaceNameSet = new Set<string>();
  
  let lastConnectionsFingerprint = "";

  function applyConnections(raw: unknown) {
    const next = asConnectionList(raw);
    const fp = connectionsFingerprint(next);
    if (fp === lastConnectionsFingerprint) {
      return;
    }
    lastConnectionsFingerprint = fp;
    connections.value = next;
  }

  Events.On("log", ({ data }: any) => {
    if (data) {
      logs.value.push(data as Log);
      if (logs.value.length > MAX_LOGS) {
        logs.value = logs.value.slice(-MAX_LOGS);
      }
    }
  });
  
  Events.On("connections", ({ data }: any) => {
    applyConnections(data);
  });
  
  Events.On("routes", ({ data }: any) => {
    const payload = unwrapEventPayload(data);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return;
    }
    routes.value = payload as RouteMonitoringStatus;
  });

  function probeFingerprint(probe: RouteProbeEvent): string {
    return (probe.slots ?? [])
      .map(
        (slot) =>
          `${slot.slot}|${slot.path_key ?? ""}|${slot.iface ?? ""}|${slot.network ?? ""}|${slot.latency}|${slot.packet_loss}`
      )
      .join(";");
  }

  function ingestRouteProbe(probe: RouteProbeEvent | null | undefined) {
    const tag = probe?.route_tag;
    if (!tag || !probe) {
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
    const last = history[history.length - 1];
    const fingerprint = probeFingerprint(probe);
    const lastTs = last?.timestamp ? new Date(last.timestamp).getTime() : 0;
    const nextTs = probe.timestamp
      ? new Date(probe.timestamp).getTime()
      : Date.now();
    // Event + poll can echo the same sample within a few hundred ms — drop it.
    if (
      last &&
      probeFingerprint(last) === fingerprint &&
      nextTs - lastTs < 400
    ) {
      return;
    }
    routeProbeHistory.value = {
      ...routeProbeHistory.value,
      [tag]: [...history, probe].slice(-MAX_ROUTE_PING_HISTORY),
    };
  }

  Events.On("route-probe", ({ data }: any) => {
    if (!data) {
      return;
    }
    // Wails Event.Emit packs args into an array — single-arg payloads land at data[0].
    ingestRouteProbe(unwrapEventPayload(data) as RouteProbeEvent);
  });

  const POLL_INTERVAL_MS = 2500;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollInFlight = false;

  const pollMonitoring = async () => {
    if (pollInFlight) {
      return;
    }
    pollInFlight = true;
    try {
      const mod = await import(
        "~/bindings/github.com/lagzap/lagzap-desktop/service"
      );
      const getConnections = (mod as { GetConnections?: () => Promise<unknown> })
        .GetConnections;
      if (typeof getConnections === "function") {
        const raw = await getConnections();
        applyConnections(raw);
      }
      const getProbes = (
        mod as { GetLatestRouteProbes?: () => Promise<unknown> }
      ).GetLatestRouteProbes;
      if (typeof getProbes === "function") {
        const raw = await getProbes();
        const list = Array.isArray(raw)
          ? raw
          : Array.isArray((raw as { data?: unknown })?.data)
            ? ((raw as { data: unknown[] }).data)
            : null;
        if (list) {
          for (const item of list) {
            ingestRouteProbe(item as RouteProbeEvent);
          }
        }
      }
    } catch {
      // Binding may not exist until wails regenerate — events still apply.
    } finally {
      pollInFlight = false;
    }
  };
  void pollMonitoring();
  pollTimer = setInterval(() => {
    void pollMonitoring();
  }, POLL_INTERVAL_MS);
  void pollTimer;
  
  return {
    logs: computed(() => logs.value),
    connections: computed(() => connections.value),
    routes: computed(() => routes.value),
    routeProbeHistory: computed(() => routeProbeHistory.value),
    probedInterfaceNames: computed(() => probedInterfaceNames.value),
    resetRoutePingHistory: () => {
      routeProbeHistory.value = {};
      probedInterfaceNameSet.clear();
      probedInterfaceNames.value = [];
    },
  };
}

export function useMonitoringStore() {
  if (!connectionsStore) {
    connectionsStore = createMonitoringStore();
  }
  return connectionsStore;
}
