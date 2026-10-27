import { Events } from "@wailsio/runtime";
import { useLocale, useTheme } from "vuetify";
import {
  SetInterfaceMonitorRange,
  SetLocationMonitor,
  SetNetworkMonitorRange,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type {
  InterfaceMonitorDetail,
  LocationMonitor,
  NetworkMonitor,
} from "~/bindings/github.com/lagzap/lagzap/adapter";
import { interfaceBaseColor } from "~/composables/useLatencyMetrics";
import { OVERVIEW_RANGES, type OverviewRange } from "~/composables/useOverviewChart";

// Go owns every number on the Monitoring page; this module only holds
// the latest snapshot and tells Go which range to stream while the page is open.
const monitor = shallowRef<NetworkMonitor | null>(null);
const range = ref<OverviewRange>("1m");
let watchers = 0;
const watcherId = crypto.randomUUID();
let offEvents: (() => void)[] = [];

async function select(next: string) {
  try {
    const snapshot = await SetNetworkMonitorRange(watcherId, next);
    if (next && next === range.value && snapshot) {
      monitor.value = snapshot;
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
    Events.On("network-monitor", ({ data }: any) => {
      const payload = (Array.isArray(data) ? data[0] : data) as NetworkMonitor | null;
      if (payload?.range === range.value) {
        monitor.value = payload;
      }
    }),
    Events.On("service-started", () => !document.hidden && select(range.value)),
    Events.On("service-stopped", () => (monitor.value = null)),
  ];
  select(range.value);
}

function stop() {
  document.removeEventListener("visibilitychange", onVisibility);
  offEvents.forEach((off) => off());
  offEvents = [];
  select("");
}

/** Vuetify color for a Go quality class. */
export function qualityColor(quality?: string): string {
  switch (quality) {
    case "excellent":
      return "success";
    case "good":
      return "light-green";
    case "fair":
      return "warning";
    case "poor":
      return "deep-orange";
    default:
      return "error";
  }
}

export function useNetworkMonitor() {
  const theme = useTheme();
  // Colors follow name order so a connection keeps its color everywhere.
  const names = computed(() => (monitor.value?.interfaces ?? []).map((i) => i.name).sort());
  const colorOf = (name: string) =>
    interfaceBaseColor(name, Math.max(0, names.value.indexOf(name)), theme.current.value.dark);

  onMounted(() => {
    if (watchers++ === 0) start();
  });
  onUnmounted(() => {
    if (--watchers === 0) stop();
  });

  function setRange(next: OverviewRange) {
    if (next === range.value) return;
    range.value = next;
    select(next);
  }

  return { monitor, range: readonly(range), ranges: OVERVIEW_RANGES, setRange, colorOf };
}

/** One connection's monitoring page. Go streams the ready snapshot on
 * "interface-monitor" while the page is open and visible. */
export function useInterfaceMonitor(iface: Ref<string>) {
  const { current } = useLocale();
  const detail = shallowRef<InterfaceMonitorDetail | null>(null);
  const local = ref<OverviewRange>(range.value);
  const watcherId = crypto.randomUUID();
  let offEvents: (() => void)[] = [];

  async function selectDetail(next: string) {
    try {
      const snapshot = await SetInterfaceMonitorRange(watcherId, iface.value, next, current.value);
      if (next && next === local.value && snapshot?.interface.name === iface.value) {
        detail.value = snapshot;
      }
    } catch {
      // service not running yet; "service-started" retries
    }
  }

  function onVisibility() {
    selectDetail(document.hidden ? "" : local.value);
  }

  onMounted(() => {
    document.addEventListener("visibilitychange", onVisibility);
    offEvents = [
      Events.On("interface-monitor", ({ data }: any) => {
        const payload = (Array.isArray(data) ? data[0] : data) as InterfaceMonitorDetail | null;
        if (payload?.range === local.value && payload.interface.name === iface.value) {
          detail.value = payload;
        }
      }),
      Events.On("service-started", () => !document.hidden && selectDetail(local.value)),
      Events.On("service-stopped", () => (detail.value = null)),
    ];
    selectDetail(local.value);
  });
  onUnmounted(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    offEvents.forEach((off) => off());
    selectDetail("");
  });

  watch([iface, current], () => {
    detail.value = null;
    selectDetail(local.value);
  });

  function setRange(next: OverviewRange) {
    if (next === local.value) return;
    local.value = next;
    selectDetail(next);
  }

  return { detail, range: readonly(local), ranges: OVERVIEW_RANGES, setRange };
}

/** One LagZap location's page. Go streams it on "location-monitor"; manual
 * asks Go to probe the location while no game uses it. */
export function useLocationMonitor(key: Ref<string>) {
  const { current } = useLocale();
  const location = shallowRef<LocationMonitor | null>(null);
  const local = ref<OverviewRange>(range.value);
  const manual = ref(false);
  const watcherId = crypto.randomUUID();
  let offEvents: (() => void)[] = [];

  async function selectLocation(next: string) {
    try {
      const snapshot = await SetLocationMonitor(watcherId, key.value, next, current.value, manual.value);
      if (next && next === local.value && snapshot?.key === key.value) {
        location.value = snapshot;
      }
    } catch {
      // service not running yet; "service-started" retries
    }
  }

  function onVisibility() {
    // Hidden window: stop the stream, keep the manual choice for later.
    selectLocation(document.hidden ? "" : local.value);
  }

  onMounted(() => {
    document.addEventListener("visibilitychange", onVisibility);
    offEvents = [
      Events.On("location-monitor", ({ data }: any) => {
        const payload = (Array.isArray(data) ? data[0] : data) as LocationMonitor | null;
        if (payload?.range === local.value && payload.key === key.value) {
          location.value = payload;
        }
      }),
      Events.On("service-started", () => !document.hidden && selectLocation(local.value)),
      Events.On("service-stopped", () => (location.value = null)),
    ];
    selectLocation(local.value);
  });
  onUnmounted(() => {
    document.removeEventListener("visibilitychange", onVisibility);
    offEvents.forEach((off) => off());
    manual.value = false;
    selectLocation("");
  });

  watch([key, current], () => {
    location.value = null;
    manual.value = false;
    selectLocation(local.value);
  });

  function setRange(next: OverviewRange) {
    if (next === local.value) return;
    local.value = next;
    selectLocation(next);
  }

  function setWatching(on: boolean) {
    manual.value = on;
    selectLocation(local.value);
  }

  return { location, range: readonly(local), ranges: OVERVIEW_RANGES, setRange, setWatching };
}
