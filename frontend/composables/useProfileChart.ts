import type { Ref, ShallowRef } from "vue";
import { Events } from "@wailsio/runtime";
import { WatchProfileChart } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { ProfileChart } from "~/bindings/github.com/lagzap/lagzap/adapter";
import { useTheme } from "vuetify";
import { colorForChartSeries, interfaceBaseColor } from "~/composables/useLatencyMetrics";
import { BEST_INTERFACE, useProfileViewInterface } from "~/composables/useProfileViewInterface";
import type { OverviewRange } from "~/composables/useOverviewChart";
import type { LiveLatencyChart } from "~/types/liveChart";

// Go owns every number of a profile chart; this module tracks which profiles
// are on screen and tells Go which range and NIC to stream for each.
type ChartView = "latency" | "traffic";
type Entry = { chart: ShallowRef<ProfileChart | null>; range: Ref<OverviewRange>; view: Ref<ChartView>; watchers: number };
const entries = new Map<string, Entry>();
let offEvents: (() => void)[] = [];

function entry(profileId: string): Entry {
  let e = entries.get(profileId);
  if (!e) {
    e = { chart: shallowRef(null), range: ref("1m"), view: ref<ChartView>("latency"), watchers: 0 };
    entries.set(profileId, e);
  }
  return e;
}

function ifaceFilter(profileId: string) {
  const key = useProfileViewInterface(profileId).selectedInterfaceKey.value;
  return key === BEST_INTERFACE ? "" : key;
}

function pinnedConnection(profileId: string) {
  return useProfileViewInterface(profileId).selectedConnectionId.value ?? "";
}

async function watchGo(profileId: string) {
  const e = entry(profileId);
  const range = e.watchers > 0 && !document.hidden ? e.range.value : "";
  try {
    const snapshot = await WatchProfileChart(profileId, range, ifaceFilter(profileId), pinnedConnection(profileId));
    if (range && snapshot) {
      e.chart.value = snapshot;
    }
  } catch {
    // service not running yet; "service-started" retries
  }
}

function rewatchAll() {
  entries.forEach((e, id) => e.watchers > 0 && watchGo(id));
}

function startEvents() {
  document.addEventListener("visibilitychange", rewatchAll);
  offEvents = [
    Events.On("profile-chart", ({ data }: any) => {
      const payload = (Array.isArray(data) ? data[0] : data) as ProfileChart | null;
      const e = payload && entries.get(payload.profile_id);
      if (e && payload.range === e.range.value && payload.iface === ifaceFilter(payload.profile_id)) {
        e.chart.value = payload;
      }
    }),
    Events.On("service-started", rewatchAll),
  ];
}

function stopEvents() {
  document.removeEventListener("visibilitychange", rewatchAll);
  offEvents.forEach((off) => off());
  offEvents = [];
}

export function useProfileChart(profileId: string) {
  const e = entry(profileId);
  const { selectedInterfaceKey, selectedConnectionId } = useProfileViewInterface(profileId);

  onMounted(() => {
    if (![...entries.values()].some((x) => x.watchers > 0)) {
      startEvents();
    }
    e.watchers++;
    watchGo(profileId);
  });
  onUnmounted(() => {
    e.watchers--;
    watchGo(profileId);
    if (![...entries.values()].some((x) => x.watchers > 0)) {
      stopEvents();
    }
  });
  watch(selectedInterfaceKey, () => {
    e.chart.value = null;
    watchGo(profileId);
  });
  watch(selectedConnectionId, () => watchGo(profileId));

  function setRange(next: OverviewRange) {
    if (next !== e.range.value) {
      e.range.value = next;
      watchGo(profileId);
    }
  }

  // Colors key off Go's NIC list so chart, legend and diagram agree.
  const theme = useTheme();
  const ifaceOrder = computed(() => e.chart.value?.interfaces ?? []);
  const latencyColor = (key: string) => colorForChartSeries(key, ifaceOrder.value, theme.current.value.dark);
  const trafficColor = (name: string) =>
    interfaceBaseColor(name, Math.max(0, ifaceOrder.value.indexOf(name)), theme.current.value.dark);

  const latency = computed<LiveLatencyChart | null>(() => {
    const c = e.chart.value?.latency;
    if (!c) return null;
    return {
      ...c,
      series: (c.series ?? []).map((s) => ({
        id: s.key,
        label: s.label,
        points: s.points,
        iface: s.iface,
        network: s.network,
        pathKey: s.path_key,
        paths: s.paths ?? undefined,
      })),
    };
  });

  return {
    chart: e.chart,
    /** Latency/Traffic tab, shared so the card can switch it (usage click). */
    view: e.view,
    latency,
    traffic: computed(() => e.chart.value?.traffic ?? null),
    range: readonly(e.range),
    setRange,
    latencyColor,
    trafficColor,
  };
}

/** The "Estimated Ping" of the view on screen (Best Internet or one NIC).
 * Reads the shared snapshot only; streaming is owned by useProfileChart. */
export function useProfileEstimate(profileId: string) {
  const e = entry(profileId);
  const { selectedInterfaceKey } = useProfileViewInterface(profileId);
  return computed(() => {
    const d = e.chart.value?.diagram;
    if (!d?.show) return null;
    if (selectedInterfaceKey.value === BEST_INTERFACE) return d.best?.estimate ?? null;
    const want = selectedInterfaceKey.value.trim().toLowerCase();
    const view = (d.interfaces ?? []).find((item) => item.name.trim().toLowerCase() === want) ?? d.interfaces?.[0];
    return view?.view?.estimate ?? null;
  });
}
