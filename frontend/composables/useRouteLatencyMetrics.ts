import { computed, ref, watch } from "vue";
import { Latency, PingPoint, type Profile } from "~/bindings/github.com/lagzap/zap/data";
import {
  type MultiInterfaceLatency,
} from "~/composables/useLatencyMetrics";
import {
  nodeRoutePathKey,
  routeRelayLatency,
  useProfileDisplayRoutes,
} from "~/composables/useProfileDisplayRoutes";
import type {
  Connection,
  NetworkSpeedPoint,
  RouteProbeSlotMetric,
} from "~/types/monitoring";

const MAX_PROFILE_SPEED_HISTORY = 120;
const MAX_ROUTE_RAW_HISTORY = 120;
const MIN_FLOWING_TRAFFIC_SPEED = 100;

/**
 * One logical flow can be mirrored across route×iface legs. Keep a single
 * speed per flow so 4 routes × 3 NICs does not multiply usage by 12.
 */
function uniqueFlowSpeeds(connections: Connection[]): {
  download: number;
  upload: number;
} {
  const byFlow = new Map<string, { download: number; upload: number }>();
  for (const connection of connections) {
    const key =
      connection.group_id ||
      [
        connection.process || "",
        connection.destination_ip || "",
        connection.destination_port || "",
        connection.network || "",
      ].join("|");
    const download = Math.abs(connection.download_speed || 0);
    const upload = Math.abs(connection.upload_speed || 0);
    const existing = byFlow.get(key);
    if (!existing) {
      byFlow.set(key, { download, upload });
      continue;
    }
    existing.download = Math.max(existing.download, download);
    existing.upload = Math.max(existing.upload, upload);
  }

  let download = 0;
  let upload = 0;
  for (const sample of byFlow.values()) {
    download += sample.download;
    upload += sample.upload;
  }
  return { download, upload };
}

function buildLatency(
  label: string,
  pingValues: Array<{ latency: number; ok: boolean; t?: number }>,
  extras: {
    packet_loss?: number;
    jitter?: number;
    score?: number;
    min_latency?: number;
    max_latency?: number;
    avg_latency?: number;
  } = {}
): Latency {
  const pings = pingValues.map(
    (point) =>
      new PingPoint({
        latency: point.latency,
        ok: point.ok,
        t: point.t,
      })
  );
  const okLatencies = pings
    .filter((point) => point.ok)
    .map((point) => point.latency ?? 0);
  const failedPings = pings.filter((point) => !point.ok).length;
  const avg =
    extras.avg_latency ??
    (okLatencies.length > 0
      ? okLatencies.reduce((sum, value) => sum + value, 0) / okLatencies.length
      : 0);

  return new Latency({
    target_ip: label,
    pings,
    avg_latency: avg,
    min_latency:
      extras.min_latency ??
      (okLatencies.length > 0 ? Math.min(...okLatencies) : 0),
    max_latency:
      extras.max_latency ??
      (okLatencies.length > 0 ? Math.max(...okLatencies) : 0),
    packet_loss: extras.packet_loss ?? 0,
    jitter: extras.jitter ?? 0,
    score: extras.score ?? 0,
    total_pings: pings.length,
    failed_pings: failedPings,
  });
}

type RoutePingSample = {
  latency: number;
  ok: boolean;
  packet_loss: number;
  jitter: number;
  score: number;
  timestamp: number;
};

function appendRouteSample(
  history: RoutePingSample[],
  sample: RoutePingSample
): RoutePingSample[] {
  return [...history, sample].slice(-MAX_ROUTE_RAW_HISTORY);
}

export function useRouteLatencyMetrics(profileId: string) {
  const store = useStore();
  const profile = computed(
    () => store.profiles.find((item) => item.id === profileId) ?? null
  );

  const emptyProfile = computed(
    () =>
      ({
        id: profileId,
        flags: 0,
        route_action: "proxy",
      }) as Profile
  );

  const { routeSeries, primaryRelayNodeId, numberOfRoutes, profileInterfaces } =
    useProfileDisplayRoutes(
      computed(() => profile.value ?? emptyProfile.value)
    );
  const { connections, routeProbeHistory, routeProbeReceivedCount } =
    useMonitoringStore();
  const {
    effectiveTcpForInterface,
    effectiveUdpForInterface,
    ensureLoaded: ensureNetworkAdapterSettingsLoaded,
  } = useNetworkAdapterSettings();
  void ensureNetworkAdapterSettingsLoaded();

  const profileSpeedHistory = ref<NetworkSpeedPoint[]>([]);
  const routePingHistory = ref<Record<string, RoutePingSample[]>>({});
  /** Last processed received-count per history key (not array index). */
  const lastProcessedProbeCount = ref<Record<string, number>>({});
  const lastProbeEventTimestamp = ref<Record<string, number>>({});

  /** Legs this NIC actually dials — profile override, else per-iface global settings. */
  function routeWeightForInterface(iface: string): number {
    const state = store.profileStates[profileId];
    if (state?.tcp_connections != null || state?.udp_connections != null) {
      return Math.max(
        1,
        (state.tcp_connections ?? 0) + (state.udp_connections ?? 0)
      );
    }
    return Math.max(
      1,
      effectiveTcpForInterface(iface) + effectiveUdpForInterface(iface)
    );
  }

  function resolveProbeHistory(
    tag: string
  ): { key: string; events: NonNullable<(typeof routeProbeHistory.value)[string]> } | null {
    const history = routeProbeHistory.value;
    const candidates = [
      tag,
      `${tag}-ipv4-udp`,
      `${tag}-ipv4-tcp`,
      `${tag}-ipv6-udp`,
      `${tag}-ipv6-tcp`,
    ];
    for (const key of candidates) {
      const events = history[key];
      if (events?.length) {
        return { key, events };
      }
    }
    for (const [key, events] of Object.entries(history)) {
      if (!events?.length) {
        continue;
      }
      if (key === tag || key.startsWith(`${tag}-`)) {
        return { key, events };
      }
    }
    return null;
  }

  function resolveSeriesKey(slot: RouteProbeSlotMetric): string | null {
    const seriesList = routeSeries.value;
    if (seriesList.length === 0) {
      return null;
    }

    // Strongest identity: interface + path (same hop list on two NICs = two lines).
    if (slot.iface && slot.path_key) {
      const byIfacePath = seriesList.find(
        (series) =>
          series.iface === slot.iface &&
          nodeRoutePathKey(series.route) === slot.path_key
      );
      if (byIfacePath) {
        return byIfacePath.key;
      }
    }

    // Stable iface + global probe slot index (backend slot is global across ifaces).
    if (slot.slot >= 0) {
      const byGlobalIndex = seriesList.find((series) => {
        if (series.index !== slot.slot) {
          return false;
        }
        if (slot.iface && series.iface && series.iface !== slot.iface) {
          return false;
        }
        return true;
      });
      if (byGlobalIndex) {
        return byGlobalIndex.key;
      }
    }

    if (slot.path_key) {
      const matches = seriesList.filter(
        (series) => nodeRoutePathKey(series.route) === slot.path_key
      );
      if (matches.length === 1) {
        return matches[0].key;
      }
      if (matches.length > 1 && slot.iface) {
        const ifaceMatch = matches.find((series) => series.iface === slot.iface);
        if (ifaceMatch) {
          return ifaceMatch.key;
        }
      }
    }

    return null;
  }

  function slotMapForEvent(slots: RouteProbeSlotMetric[]) {
    const bySeriesKey = new Map<string, RouteProbeSlotMetric>();
    for (const slot of slots) {
      const key = resolveSeriesKey(slot);
      if (!key) {
        continue;
      }
      const existing = bySeriesKey.get(key);
      if (!existing) {
        bySeriesKey.set(key, slot);
        continue;
      }
      if (slot.latency > 0) {
        if (existing.latency <= 0 || slot.latency < existing.latency) {
          bySeriesKey.set(key, slot);
        }
      }
    }
    return bySeriesKey;
  }

  function seedRouteHistoryFromRoutes() {
    const seriesList = routeSeries.value.slice(0, numberOfRoutes.value);
    if (seriesList.length === 0) {
      return;
    }

    let nextHistory = { ...routePingHistory.value };
    let changed = false;

    for (const series of seriesList) {
      if ((nextHistory[series.key] ?? []).length > 0) {
        continue;
      }
      const baseline = routeRelayLatency(series.route);
      if (baseline <= 0) {
        continue;
      }
      nextHistory[series.key] = [
        {
          latency: baseline,
          ok: true,
          packet_loss: series.route.packet_loss ?? 0,
          jitter: series.route.jitter ?? 0,
          score: series.route.score ?? 0,
          timestamp: Date.now(),
        },
      ];
      changed = true;
    }

    if (changed) {
      routePingHistory.value = nextHistory;
    }
  }

  function appendProbeSamples() {
    const tag = primaryRelayNodeId.value;
    if (!tag) {
      return;
    }

    const resolved = resolveProbeHistory(tag);
    if (!resolved) {
      return;
    }
    const { key, events } = resolved;

    const seriesList = routeSeries.value.slice(0, numberOfRoutes.value);
    if (seriesList.length === 0) {
      return;
    }

    const totalReceived =
      routeProbeReceivedCount.value[key] ?? events.length;
    const lastProcessed = lastProcessedProbeCount.value[key] ?? 0;
    const newCount = totalReceived - lastProcessed;
    if (newCount <= 0) {
      return;
    }

    // Ring buffer may hold fewer events than newCount after truncation.
    const pending = events.slice(-Math.min(newCount, events.length));
    if (pending.length === 0) {
      lastProcessedProbeCount.value = {
        ...lastProcessedProbeCount.value,
        [key]: totalReceived,
      };
      return;
    }

    let nextHistory = { ...routePingHistory.value };
    let lastEventTs = lastProbeEventTimestamp.value[key] ?? 0;

    for (const event of pending) {
      const timestamp = event.timestamp
        ? new Date(event.timestamp).getTime()
        : Date.now();

      const slotByKey = slotMapForEvent(event.slots ?? []);

      for (const series of seriesList) {
        const slot = slotByKey.get(series.key);
        const history = nextHistory[series.key] ?? [];

        if (slot && slot.latency > 0) {
          nextHistory[series.key] = appendRouteSample(history, {
            latency: slot.latency,
            ok: true,
            packet_loss: slot.packet_loss ?? 0,
            jitter: slot.jitter ?? 0,
            score: slot.score ?? 0,
            timestamp,
          });
          continue;
        }

        // Side-probe miss (latency 0 / absent) is NOT game lag. The live
        // session can be healthy at ~100ms while a probe budget cancels.
        // Carry the last good sample — never paint fake Timeout markers.
        const last = history[history.length - 1];
        if (last?.ok && last.latency > 0) {
          nextHistory[series.key] = appendRouteSample(history, {
            ...last,
            timestamp,
          });
        }
      }

      lastEventTs = timestamp;
    }

    routePingHistory.value = nextHistory;
    lastProcessedProbeCount.value = {
      ...lastProcessedProbeCount.value,
      [key]: totalReceived,
    };
    lastProbeEventTimestamp.value = {
      ...lastProbeEventTimestamp.value,
      [key]: lastEventTs,
    };
  }

  watch(routeProbeHistory, appendProbeSamples, { deep: true, immediate: true });
  watch(routeProbeReceivedCount, appendProbeSamples, { deep: true });
  watch(
    () => [routeSeries.value.length, numberOfRoutes.value] as const,
    () => {
      seedRouteHistoryFromRoutes();
      appendProbeSamples();
    },
    { immediate: true }
  );
  watch(primaryRelayNodeId, (tag, previousTag) => {
    // Keep history when the same relay tag is re-emitted; only clear on change.
    if (tag === previousTag) {
      return;
    }
    routePingHistory.value = {};
    if (previousTag) {
      const nextCount = { ...lastProcessedProbeCount.value };
      const nextTs = { ...lastProbeEventTimestamp.value };
      for (const key of Object.keys(nextCount)) {
        if (key === previousTag || key.startsWith(`${previousTag}-`)) {
          delete nextCount[key];
          delete nextTs[key];
        }
      }
      lastProcessedProbeCount.value = nextCount;
      lastProbeEventTimestamp.value = nextTs;
    }
    if (tag) {
      seedRouteHistoryFromRoutes();
      appendProbeSamples();
    }
  });

  const latency = computed<MultiInterfaceLatency | null>(() => {
    if (routeSeries.value.length === 0) {
      return null;
    }

    const interfaces: Record<string, Latency> = {};
    let bestScore = 0;

    for (const series of routeSeries.value) {
      const history = routePingHistory.value[series.key] ?? [];

      if (history.length === 0) {
        // No samples yet for this iface×path — omit from chart/legend so
        // empty labels (e.g. "Tehran 01 (Ethernet 2)" with no line) do not appear.
        continue;
      }

      const pings = history.map((point) => ({
        latency: point.latency,
        ok: point.ok,
        t: point.timestamp,
      }));
      const last = history[history.length - 1];
      const okLatencies = pings
        .filter((point) => point.ok)
        .map((point) => point.latency);

      interfaces[series.key] = buildLatency(series.label, pings, {
        packet_loss: last.packet_loss,
        jitter: last.jitter,
        score: last.score,
        min_latency:
          okLatencies.length > 0 ? Math.min(...okLatencies) : undefined,
        max_latency:
          okLatencies.length > 0 ? Math.max(...okLatencies) : undefined,
      });
      bestScore = Math.max(bestScore, last.score ?? 0);
    }

    return {
      interfaces,
      best_score: bestScore,
    };
  });

  /**
   * Connection speed is exact once (e.g. game ↓100KB). Multipath mirrors that
   * full rate on every route leg, so an iface with 2 routes "carries" 200KB of
   * reported usage and an iface with 1 route carries 100KB. Stack one band per
   * internet using traffic × routes_on_that_iface (from profile / global settings).
   */
  watch(
    connections,
    (items) => {
      const profileConnections = (items ?? []).filter(
        (connection) => connection.profile_id === profileId
      );
      if (profileConnections.length === 0) {
        return;
      }

      const { download, upload } = uniqueFlowSpeeds(profileConnections);
      if (download + upload < MIN_FLOWING_TRAFFIC_SPEED) {
        return;
      }

      const ifaces = (profileInterfaces.value ?? []).filter((name) => !!name);
      const names = ifaces.length > 0 ? ifaces : ["Default"];
      const interfaces: NetworkSpeedPoint["interfaces"] = {};
      for (const name of names) {
        const routes = routeWeightForInterface(name);
        interfaces[name] = {
          download: download * routes,
          upload: upload * routes,
        };
      }

      profileSpeedHistory.value = [
        ...profileSpeedHistory.value,
        { interfaces },
      ].slice(-MAX_PROFILE_SPEED_HISTORY);
    },
    { deep: true }
  );

  const hasLatencyData = computed(() => {
    // Always show the chart once route series exist so used-route lines stay
    // mounted instead of unmounting when history briefly looks empty.
    if (routeSeries.value.length > 0) {
      return true;
    }
    for (const history of Object.values(routePingHistory.value)) {
      if (history.some((sample) => sample.ok)) {
        return true;
      }
    }

    if (profileSpeedHistory.value.length > 0) {
      return true;
    }

    return false;
  });

  return {
    latency,
    hasLatencyData,
    profileSpeedHistory: computed(() => profileSpeedHistory.value),
    routeSeries,
  };
}
