import { Events } from "@wailsio/runtime";
import { SetOverviewRange } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { OverviewChart } from "~/bindings/github.com/lagzap/lagzap/adapter";
import { useTheme } from "vuetify";
import { interfaceBaseColor } from "~/composables/useLatencyMetrics";

export type OverviewRange = "1m" | "5m" | "15m" | "60m";
export const OVERVIEW_RANGES: OverviewRange[] = ["1m", "5m", "15m", "60m"];

// Go owns every number on the Overview page; this module only holds the
// latest snapshot and tells Go which range to stream while someone watches.
const chart = shallowRef<OverviewChart | null>(null);
const range = ref<OverviewRange>("1m");
let watchers = 0;
const watcherId = crypto.randomUUID();

// Colors follow name order so a NIC keeps its color across tabs, ranges and the card.
const names = computed(() => {
  const set = new Set<string>();
  chart.value?.latency?.series?.forEach((s) => set.add(s.name));
  chart.value?.traffic?.series?.forEach((s) => set.add(s.name));
  return [...set].sort();
});
let offEvents: (() => void)[] = [];

async function select(next: string) {
  try {
    const snapshot = await SetOverviewRange(watcherId, next);
    if (next && next === range.value && snapshot) {
      chart.value = snapshot;
    }
  } catch {
    // service not running yet; "service-started" retries
  }
}

// Pause the Go stream while the window is minimized or hidden.
function onVisibility() {
  select(document.hidden ? "" : range.value);
}

function start() {
  document.addEventListener("visibilitychange", onVisibility);
  offEvents = [
    Events.On("overview", ({ data }: any) => {
      const payload = (Array.isArray(data) ? data[0] : data) as OverviewChart | null;
      if (payload?.range === range.value) {
        chart.value = payload;
      }
    }),
    Events.On("service-started", () => !document.hidden && select(range.value)),
    Events.On("service-stopped", () => (chart.value = null)),
  ];
  select(range.value);
}

function stop() {
  document.removeEventListener("visibilitychange", onVisibility);
  offEvents.forEach((off) => off());
  offEvents = [];
  select("");
}

export function useOverviewChart() {
  const theme = useTheme();
  const colorOf = (name: string) =>
    interfaceBaseColor(name, Math.max(0, names.value.indexOf(name)), theme.current.value.dark);

  onMounted(() => {
    if (watchers++ === 0) {
      start();
    }
  });
  onUnmounted(() => {
    if (--watchers === 0) {
      stop();
    }
  });

  function setRange(next: OverviewRange) {
    if (next === range.value) {
      return;
    }
    range.value = next;
    select(next);
  }

  return { chart, range: readonly(range), setRange, colorOf };
}
