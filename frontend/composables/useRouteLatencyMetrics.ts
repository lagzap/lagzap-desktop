import { computed, onUnmounted, ref, watch, type Ref } from "vue";
import { Latency, PingPoint, type Profile } from "~/bindings/github.com/lagzap/zap/data";
import {
  PING_TIMEOUT_MS,
  type MultiInterfaceLatency,
} from "~/composables/useLatencyMetrics";
import {
  nodeRoutePathKey,
  useProfileDisplayRoutes,
} from "~/composables/useProfileDisplayRoutes";
import type {
  NetworkSpeedPoint,
  RouteProbeSlotMetric,
} from "~/types/monitoring";

const MAX_PROFILE_SPEED_HISTORY = 3600;
const MAX_ROUTE_PING_HISTORY = 3600;
const MIN_FLOWING_TRAFFIC_SPEED = 1024;

function buildLatency(
  label: string,
  pingValues: Array<{ latency: number; ok: boolean }>,
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
    (point) => new PingPoint({ latency: point.latency, ok: point.ok })
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

// Match backend watchedRouteProbeTimeout (3s): brief coordinator stalls should
// not break every route line at once.
const PROBE_GAP_MS = 3000;
const PROBE_STALL_SAMPLE_MS = 1000;
const PROBE_STALL_CHECK_MS = 1000;

function failedProbeSample(timestamp: number): RoutePingSample {
  return {
    latency: PING_TIMEOUT_MS,
    ok: false,
    packet_loss: 100,
    jitter: 0,
    score: 0,
    timestamp,
  };
}

function appendRouteSample(
  history: RoutePingSample[],
  sample: RoutePingSample
): RoutePingSample[] {
  return [...history, sample].slice(-MAX_ROUTE_PING_HISTORY);
}

function fillProbeGaps(
  history: RoutePingSample[],
  fromTimestamp: number,
  toTimestamp: number
): RoutePingSample[] {
  let next = history;
  let cursor = fromTimestamp + PROBE_STALL_SAMPLE_MS;
  while (cursor < toTimestamp - PROBE_STALL_SAMPLE_MS / 2) {
    next = appendRouteSample(next, failedProbeSample(cursor));
    cursor += PROBE_STALL_SAMPLE_MS;
  }
  return next;
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

  const { routeSeries, primaryRelayNodeId, numberOfRoutes } =
    useProfileDisplayRoutes(
      computed(() => profile.value ?? emptyProfile.value)
    );
  const { connections, routeProbeHistory } = useMonitoringStore();
  const profileSpeedHistory = ref<NetworkSpeedPoint[]>([]);
  const routePingHistory = ref<Record<string, RoutePingSample[]>>({});
  const lastProcessedProbeIndex = ref<Record<string, number>>({});
  const lastProbeEventTimestamp = ref<Record<string, number>>({});

  function resolveSeriesKey(slot: RouteProbeSlotMetric): string | null {
    if (slot.slot >= 0 && slot.slot < routeSeries.value.length) {
      return routeSeries.value[slot.slot]?.key ?? `route-${slot.slot + 1}`;
    }

    if (slot.path_key) {
      const match = routeSeries.value.find(
        (series) => nodeRoutePathKey(series.route) === slot.path_key
      );
      if (match) {
        return match.key;
      }
    }

    return slot.slot >= 0 ? `route-${slot.slot + 1}` : null;
  }

  function slotMapForEvent(slots: RouteProbeSlotMetric[]) {
    const byKey = new Map<string, RouteProbeSlotMetric>();
    for (const slot of slots) {
      const key = resolveSeriesKey(slot);
      if (key) {
        byKey.set(key, slot);
      }
    }
    return byKey;
  }

  function appendProbeSamples() {
    const tag = primaryRelayNodeId.value;
    if (!tag) {
      return;
    }

    const events = routeProbeHistory.value[tag];
    if (!events?.length) {
      return;
    }

    const seriesList = routeSeries.value.slice(0, numberOfRoutes.value);
    if (seriesList.length === 0) {
      return;
    }

    const startIndex = (lastProcessedProbeIndex.value[tag] ?? -1) + 1;
    const pending = events.slice(startIndex);
    if (pending.length === 0) {
      return;
    }

    let nextHistory = { ...routePingHistory.value };
    let lastEventTs = lastProbeEventTimestamp.value[tag] ?? 0;

    for (const event of pending) {
      const timestamp = event.timestamp
        ? new Date(event.timestamp).getTime()
        : Date.now();

      if (lastEventTs > 0 && timestamp - lastEventTs > PROBE_GAP_MS) {
        for (const series of seriesList) {
          const history = nextHistory[series.key] ?? [];
          nextHistory[series.key] = fillProbeGaps(
            history,
            lastEventTs,
            timestamp
          );
        }
      }

      const slotByKey = slotMapForEvent(event.slots ?? []);

      for (const series of seriesList) {
        const slot = slotByKey.get(series.key);
        const responded = !!slot && slot.latency > 0;
        const history = nextHistory[series.key] ?? [];

        nextHistory[series.key] = appendRouteSample(
          history,
          responded
            ? {
                latency: slot.latency,
                ok: true,
                packet_loss: slot.packet_loss ?? 0,
                jitter: slot.jitter ?? 0,
                score: slot.score ?? 0,
                timestamp,
              }
            : failedProbeSample(timestamp)
        );
      }

      lastEventTs = timestamp;
    }

    routePingHistory.value = nextHistory;
    lastProcessedProbeIndex.value = {
      ...lastProcessedProbeIndex.value,
      [tag]: events.length - 1,
    };
    lastProbeEventTimestamp.value = {
      ...lastProbeEventTimestamp.value,
      [tag]: lastEventTs,
    };
  }

  function extendStaleProbeGaps() {
    const tag = primaryRelayNodeId.value;
    if (!tag) {
      return;
    }

    const lastTs = lastProbeEventTimestamp.value[tag];
    if (!lastTs) {
      return;
    }

    const now = Date.now();
    if (now - lastTs < PROBE_GAP_MS) {
      return;
    }

    const seriesList = routeSeries.value.slice(0, numberOfRoutes.value);
    if (seriesList.length === 0) {
      return;
    }

    const gapTimestamp = lastTs + PROBE_STALL_SAMPLE_MS;
    if (now < gapTimestamp) {
      return;
    }

    let nextHistory = { ...routePingHistory.value };
    for (const series of seriesList) {
      const history = nextHistory[series.key] ?? [];
      const last = history[history.length - 1];
      if (last?.timestamp === gapTimestamp) {
        continue;
      }
      nextHistory[series.key] = appendRouteSample(
        history,
        failedProbeSample(gapTimestamp)
      );
    }

    routePingHistory.value = nextHistory;
    lastProbeEventTimestamp.value = {
      ...lastProbeEventTimestamp.value,
      [tag]: gapTimestamp,
    };
  }

  const staleGapTimer = setInterval(extendStaleProbeGaps, PROBE_STALL_CHECK_MS);
  onUnmounted(() => {
    clearInterval(staleGapTimer);
  });

  watch(routeProbeHistory, appendProbeSamples, { deep: true, immediate: true });
  watch(primaryRelayNodeId, (tag, previousTag) => {
    routePingHistory.value = {};
    if (previousTag) {
      const nextIndex = { ...lastProcessedProbeIndex.value };
      const nextTs = { ...lastProbeEventTimestamp.value };
      delete nextIndex[previousTag];
      delete nextTs[previousTag];
      lastProcessedProbeIndex.value = nextIndex;
      lastProbeEventTimestamp.value = nextTs;
    }
    if (tag) {
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
        interfaces[series.label] = buildLatency(series.label, []);
        continue;
      }

      const pings = history.map((point) => ({
        latency: point.latency,
        ok: point.ok,
      }));
      const last = history[history.length - 1];
      const okLatencies = pings
        .filter((point) => point.ok)
        .map((point) => point.latency);

      interfaces[series.label] = buildLatency(series.label, pings, {
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

  watch(
    connections,
    (items) => {
      const profileConnections = (items ?? []).filter(
        (connection) => connection.profile_id === profileId
      );
      if (profileConnections.length === 0) {
        return;
      }

      const download = profileConnections.reduce(
        (sum, connection) => sum + (connection.download_speed || 0),
        0
      );
      const upload = profileConnections.reduce(
        (sum, connection) => sum + (connection.upload_speed || 0),
        0
      );

      if (download + upload < MIN_FLOWING_TRAFFIC_SPEED) {
        return;
      }

      profileSpeedHistory.value = [
        ...profileSpeedHistory.value,
        {
          interfaces: {
            traffic: { download, upload },
          },
        },
      ].slice(-MAX_PROFILE_SPEED_HISTORY);
    },
    { deep: true }
  );

  return {
    latency,
    profileSpeedHistory: computed(() => profileSpeedHistory.value) as Ref<
      NetworkSpeedPoint[]
    >,
    routeSeries,
  };
}
