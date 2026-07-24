import { computed, ref, watch } from "vue";
import { debounce } from "es-toolkit";
import { Latency, PingPoint, type Profile } from "~/bindings/github.com/lagzap/zap/data";
import {
  type MultiInterfaceLatency,
} from "~/composables/useLatencyMetrics";
import {
  nodeRoutePathKey,
  routeRelayLatency,
  isPlausibleProbeForRoute,
  useProfileDisplayRoutes,
} from "~/composables/useProfileDisplayRoutes";
import {
  BEST_INTERFACE,
  useProfileViewInterface,
} from "~/composables/useProfileViewInterface";
import { isPingTimeout, PING_TIMEOUT_MS } from "~/constants/pingChart";
import type {
  Connection,
  NetworkSpeedPoint,
  RouteProbeSlotMetric,
} from "~/types/monitoring";

const MAX_PROFILE_SPEED_HISTORY = 120;
const MAX_ROUTE_RAW_HISTORY = 120;
const MIN_FLOWING_TRAFFIC_SPEED = 100;
const PROFILE_SPEED_PUSH_MS = 1000;
/** Profile line chart Y max — samples at/above this gap as timeouts instead of roof spikes. */
const ROUTE_CHART_SPIKE_MS = 500;
/** Per-series loss for chart objects — same window as the header summary. */
const ROUTE_LOSS_WINDOW_SECONDS = 30;
const ROUTE_PROBE_SAMPLES_PER_SECOND = 2;

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

function isUsableRouteSample(latency: number, ok = true): boolean {
  if (!ok || isPingTimeout(latency, ok)) {
    return false;
  }
  // Line chart Y is capped at 500 — treat spikes as timeouts so lines gap
  // instead of drawing vertical lines into the roof.
  return latency > 0 && latency < ROUTE_CHART_SPIKE_MS;
}

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

  const { chartSeriesForInterface, primaryRelayNodeId, profileInterfaces } =
    useProfileDisplayRoutes(
      computed(() => profile.value ?? emptyProfile.value)
    );
  const { selectedInterfaceKey } = useProfileViewInterface(profileId);
  // Best Internet → all selected NICs; a named NIC → that NIC only.
  const chartRouteSeries = computed(() =>
    chartSeriesForInterface(
      selectedInterfaceKey.value === BEST_INTERFACE
        ? "best"
        : selectedInterfaceKey.value
    )
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
    const seriesList = chartRouteSeries.value;
    if (seriesList.length === 0) {
      return null;
    }

    if (slot.path_key) {
      const matches = seriesList.filter(
        (series) => nodeRoutePathKey(series.route) === slot.path_key
      );
      if (slot.iface) {
        const ifaceMatch = matches.find((series) => series.iface === slot.iface);
        if (ifaceMatch) {
          return ifaceMatch.key;
        }
      }
      if (matches.length === 1) {
        return matches[0].key;
      }
    }

    return null;
  }

  function slotMapForEvent(slots: RouteProbeSlotMetric[]) {
    const bySeriesKey = new Map<string, RouteProbeSlotMetric>();
    const assigned = new Set<RouteProbeSlotMetric>();
    const seriesList = chartRouteSeries.value;

    // 1) Exact path matches (success or timeout — PathKey is set either way).
    for (const slot of slots) {
      const key = resolveSeriesKey(slot);
      if (!key) {
        continue;
      }
      assigned.add(slot);
      const existing = bySeriesKey.get(key);
      if (!existing) {
        bySeriesKey.set(key, slot);
        continue;
      }
      const slotOk = isUsableRouteSample(slot.latency ?? 0);
      const existingOk = isUsableRouteSample(existing.latency ?? 0);
      // Prefer a usable sample; among usable, keep the later/higher slot identity
      // (do not prefer lucky minimum — that drew 4–20ms spikes).
      if (slotOk && !existingOk) {
        bySeriesKey.set(key, slot);
      } else if (slotOk && existingOk) {
        bySeriesKey.set(key, slot);
      } else if (!slotOk && !existingOk && (slot.packet_loss ?? 0) >= (existing.packet_loss ?? 0)) {
        bySeriesKey.set(key, slot);
      }
    }

    // 2) Remaining probes zip by local order within each NIC (legs may rotate;
    //    slot index is the stable identity). Include failed probes (latency 0).
    const unused = slots.filter((slot) => !assigned.has(slot));
    const byIface = new Map<string, RouteProbeSlotMetric[]>();
    for (const slot of unused) {
      const iface = slot.iface || "";
      const list = byIface.get(iface) ?? [];
      list.push(slot);
      byIface.set(iface, list);
    }

    for (const [iface, ifaceSlots] of byIface) {
      const orderedProbes = ifaceSlots
        .slice()
        .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
      const orderedSeries = seriesList
        .filter((series) => (series.iface || "") === iface)
        .slice()
        .sort((a, b) => a.slot - b.slot)
        .filter((series) => !bySeriesKey.has(series.key));

      for (let i = 0; i < orderedProbes.length && i < orderedSeries.length; i++) {
        bySeriesKey.set(orderedSeries[i].key, orderedProbes[i]);
      }
    }

    return bySeriesKey;
  }

  function seedRouteHistoryFromRoutes() {
    const seriesList = chartRouteSeries.value;
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
      if (!isUsableRouteSample(baseline)) {
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

    const seriesList = chartRouteSeries.value;
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

      const slots = event.slots ?? [];
      const slotByKey = slotMapForEvent(slots);

      for (const series of seriesList) {
        const slot = slotByKey.get(series.key);
        const history = nextHistory[series.key] ?? [];

        if (slot) {
          const latency = slot.latency ?? 0;
          const loss = slot.packet_loss ?? 0;
          const floor = series.hopFloorMs ?? 0;
          const plausible =
            isUsableRouteSample(latency) &&
            isPlausibleProbeForRoute(latency, series.route, floor);
          if (plausible) {
            nextHistory[series.key] = appendRouteSample(history, {
              latency,
              ok: true,
              packet_loss: loss,
              jitter: slot.jitter ?? 0,
              score: slot.score ?? 0,
              timestamp,
            });
          } else {
            // Timeout, spike, or impossibly-fast probe — gap the line and mark loss.
            nextHistory[series.key] = appendRouteSample(history, {
              latency: PING_TIMEOUT_MS,
              ok: false,
              packet_loss: loss > 0 ? loss : 100,
              jitter: slot.jitter ?? 0,
              score: slot.score ?? 0,
              timestamp,
            });
          }
        }
        // No matching probe this tick: do not invent timeouts or hold last RTT.
        // Invented timeouts painted permanent red diamond lines for healthy
        // padded slots; hold-last froze the chart at a flat ms value.
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

  const probeAppendKey = computed(() => {
    const tag = primaryRelayNodeId.value;
    if (!tag) {
      return "";
    }
    const resolved = resolveProbeHistory(tag);
    const key = resolved?.key ?? tag;
    const received = routeProbeReceivedCount.value[key] ?? 0;
    const eventCount = resolved?.events.length ?? 0;
    return `${key}:${received}:${eventCount}`;
  });

  watch(probeAppendKey, () => appendProbeSamples(), { immediate: true });
  watch(
    () => chartRouteSeries.value.map((series) => series.key).join("|"),
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
    if (chartRouteSeries.value.length === 0) {
      return null;
    }

    const interfaces: Record<string, Latency> = {};
    let bestScore = 0;

    for (const series of chartRouteSeries.value) {
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
        .filter((point) => point.ok && isUsableRouteSample(point.latency ?? 0, true))
        .map((point) => point.latency);
      const windowSamples = Math.max(
        1,
        Math.round(ROUTE_LOSS_WINDOW_SECONDS * ROUTE_PROBE_SAMPLES_PER_SECOND)
      );
      const recent = history.slice(-windowSamples);
      const windowLoss =
        recent.length === 0
          ? 0
          : (recent.filter((point) => !point.ok).length / recent.length) * 100;

      interfaces[series.key] = buildLatency(series.label, pings, {
        // Rolling ~30s rate — not last-tick 0%/100% flicker.
        packet_loss: windowLoss,
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
  const pushProfileSpeedSample = debounce((profileConnections: Connection[]) => {
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
  }, PROFILE_SPEED_PUSH_MS);

  watch(
    connections,
    (items) => {
      const profileConnections = (items ?? []).filter(
        (connection) => connection.profile_id === profileId
      );
      if (profileConnections.length === 0) {
        return;
      }
      pushProfileSpeedSample(profileConnections);
    },
    { deep: true }
  );

  const hasLatencyData = computed(() => {
    // Always show the chart once route series exist so used-route lines stay
    // mounted instead of unmounting when history briefly looks empty.
    if (chartRouteSeries.value.length > 0) {
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
    chartRouteSeries,
  };
}
