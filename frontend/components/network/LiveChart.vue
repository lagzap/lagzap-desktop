<script setup lang="ts">
import * as echarts from "echarts";
import { quietChart } from "~/utils/chartIdle";
import { useLocale, useTheme } from "vuetify";
import { PING_TIMEOUT_COLOR } from "~/composables/useLatencyMetrics";
import { OVERVIEW_RANGES } from "~/composables/useOverviewChart";
import { useHumanSpeed } from "~/composables/helper";
import type { OverviewTrafficChart } from "~/bindings/github.com/lagzap/lagzap/adapter";
import type { LiveLatencyChart, LiveLatencySeries } from "~/types/liveChart";
import { useNodeLocationLabel } from "~/composables/useNodeLocationLabel";

// Presentational chart: every number arrives ready from Go.

const props = withDefaults(
  defineProps<{
    latency?: LiveLatencyChart | null;
    traffic?: OverviewTrafficChart | null;
    range: string;
    latencyColor: (id: string) => string;
    trafficColor: (name: string) => string;
    chartHeight?: number;
    sessionStart?: number;
    compact?: boolean;
    /** Pin one view (no tabs); used by pages that show both charts. */
    fixedView?: "latency" | "traffic";
    hideStats?: boolean;
    /** Controlled tab (v-model:view); internal when omitted. */
    view?: "latency" | "traffic";
  }>(),
  { chartHeight: 200, sessionStart: 0, compact: false, fixedView: undefined, hideStats: false, view: undefined }
);
const emit = defineEmits<{ "update:range": [string]; "update:view": ["latency" | "traffic"] }>();

const { t } = useLocale();
const theme = useTheme();

type View = "latency" | "traffic";
const view = ref<View>(props.fixedView ?? props.view ?? "latency");
watch(
  () => props.view,
  (v) => v && !props.fixedView && (view.value = v)
);
function selectView(v: View) {
  view.value = v;
  emit("update:view", v);
}
const hidden = ref(new Set<string>());
const chartEl = ref<HTMLDivElement>();
let instance: echarts.ECharts | null = null;
let resizeObserver: ResizeObserver | null = null;

const rangeItems = OVERVIEW_RANGES.map((r) => ({ title: r, value: r }));
const latency = computed(() => props.latency);
const traffic = computed(() => props.traffic);

const { getNodeLabelByIp } = useNodeLocationLabel();

/** A profile route named by where it enters: the hops before the relay
 * ("Turkey", "Tehran → Turkey"), or Direct straight to the relay. Other
 * charts keep Go's label. */
function pathName(pathKey: string): string {
  const hops = pathKey.split("->").filter(Boolean);
  if (hops.length <= 1) return t("$vuetify.networkLatency.routeDirect");
  return hops
    .slice(0, -1)
    .map((ip) => getNodeLabelByIp(ip) || ip)
    .join(" → ");
}

type PathAt = { pathKey: string; network?: string };

/** The latest path a line used (a pulled route keeps its last one). */
function latestPath(s: LiveLatencySeries): PathAt | null {
  for (let i = (s.paths?.length ?? 0) - 1; i >= 0; i--) {
    const p = s.paths![i];
    if (p.path_key) return { pathKey: p.path_key, network: p.network };
  }
  return s.pathKey ? { pathKey: s.pathKey, network: s.network } : null;
}

/** The path a line was on at time t (ms): null while it was pulled. Lines
 * without a history use their one path; before its first entry a line shows
 * the history it was started with, which is its first path's. */
function pathAt(s: LiveLatencySeries, at: number): PathAt | null {
  if (!s.paths?.length) return s.pathKey ? { pathKey: s.pathKey, network: s.network } : null;
  const first = s.paths[0];
  let found: PathAt | null = first.path_key ? { pathKey: first.path_key, network: first.network } : null;
  for (const p of s.paths) {
    if (p.at > at) break;
    found = p.path_key ? { pathKey: p.path_key, network: p.network } : null;
  }
  return found;
}

function routeName(s: LiveLatencySeries): string {
  const p = latestPath(s);
  return p ? pathName(p.pathKey) : displayLabel(s.label);
}

type LegendItem = { id: string; label: string; color: string; visible: boolean; network?: string };
type LegendGroup = { iface: string; items: LegendItem[] };

/** Legend and tooltip rows, grouped by adapter for profile routes. */
const legendGroups = computed<LegendGroup[]>(() => {
  if (view.value !== "latency") {
    return [{
      iface: "",
      items: (traffic.value?.series ?? []).map((s) => ({ id: s.name, label: s.name, color: props.trafficColor(s.name), visible: !hidden.value.has(s.name) })),
    }];
  }
  const groups: LegendGroup[] = [];
  const byIface = new Map<string, LegendGroup>();
  for (const s of latency.value?.series ?? []) {
    const iface = s.iface ?? "";
    let group = byIface.get(iface);
    if (!group) {
      group = { iface, items: [] };
      byIface.set(iface, group);
      groups.push(group);
    }
    group.items.push({ id: s.id, label: routeName(s), color: props.latencyColor(s.id), visible: !hidden.value.has(s.id), network: latestPath(s)?.network ?? s.network });
  }
  // Two routes with the same entry and transport on one adapter: number them.
  for (const group of groups) {
    const seen = new Map<string, number>();
    for (const item of group.items) {
      const key = `${item.label}|${item.network ?? ""}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n > 1) item.label = `${item.label} (${localDigits(n)})`;
    }
  }
  return groups;
});
const legend = computed(() => legendGroups.value.flatMap((g) => g.items));

function networkColor(network?: string) {
  const dark = theme.current.value.dark;
  return network === "tcp" ? (dark ? "#64B5F6" : "#1565C0") : dark ? "#81C784" : "#2E7D32";
}

const hasData = computed(() =>
  view.value === "latency" ? !!latency.value?.series?.length : !!traffic.value?.series?.length
);

function toggle(name: string) {
  const next = new Set(hidden.value);
  next.has(name) ? next.delete(name) : next.add(name);
  hidden.value = next;
}

function chrome() {
  return theme.current.value.dark
    ? { bg: "rgba(18,18,18,0.92)", border: "rgba(255,255,255,0.08)", text: "#fff", muted: "#888", shadow: "0 8px 24px rgba(0,0,0,0.35)" }
    : { bg: "rgba(255,255,255,0.96)", border: "rgba(0,0,0,0.14)", text: "#171717", muted: "#5C5C5C", shadow: "0 8px 24px rgba(0,0,0,0.12)" };
}

function alpha(hex: string, a: number) {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const gradients = new Map<string, echarts.graphic.LinearGradient>();
function area(color: string, top: number) {
  const key = `${color}|${top}`;
  let g = gradients.get(key);
  if (!g) {
    g = new echarts.graphic.LinearGradient(0, 0, 0, 1, [
      { offset: 0, color: alpha(color, top) },
      { offset: 1, color: alpha(color, 0.02) },
    ]);
    gradients.set(key, g);
  }
  return g;
}

const gap = (v: number) => (v > 0 ? v : null);

const GRID_LEFT_LATENCY = 28;
const GRID_LEFT_TRAFFIC = 56;
const GRID_RIGHT = 12;
const GRID_Y = 8;

// The newest points still wait on replies (up to the 3s timeout) and can
// change; Go says how many. A plain overlay brightens that stretch: it never
// touches the chart's own updates.
const pendingBand = computed(() => {
  if (view.value !== "latency") return null;
  const n = latency.value?.series?.[0]?.points.length ?? 0;
  const pending = Math.min(latency.value?.pending ?? 0, n - 1);
  if (n < 2 || pending <= 0) return null;
  const plot = `(100% - ${GRID_LEFT_LATENCY + GRID_RIGHT}px)`;
  return {
    right: `${GRID_RIGHT}px`,
    top: `${GRID_Y}px`,
    bottom: `${GRID_Y}px`,
    width: `calc(${plot} * ${pending / (n - 1)})`,
  };
});

// A line with symbols off draws nothing for a value between two gaps; give
// those lone samples a dot so a sparse series never looks empty.
function lonePoints(values: (number | null)[]) {
  return values.map((v, i) => (v !== null && values[i - 1] == null && values[i + 1] == null ? v : null));
}
const anyPoint = (values: (number | null)[]) => values.some((v) => v !== null);
// Overlay series exist only while they draw something: every series costs a
// full ECharts pass on each tick, and these are empty almost always.
function loneDots(name: string, values: (number | null)[], color: string) {
  const data = lonePoints(values);
  if (!anyPoint(data)) return null;
  return {
    id: `__lone__${name}`,
    name: `__lone__${name}`,
    type: "scatter",
    data,
    symbolSize: 4,
    itemStyle: { color },
    tooltip: { show: false },
    silent: true,
    z: 3,
  };
}
const pointCount = () =>
  (view.value === "latency" ? latency.value?.series?.[0]?.points.length : traffic.value?.series?.[0]?.download.length) ?? 0;

// One red dot per route timeout (on that route's line); a full-height bar only
// when every route that was sampled timed out at the same moment.
function latencySeries() {
  const c = latency.value!;
  const visible = c.series.filter((s) => !hidden.value.has(s.id));
  const allLost: (number | null)[] = new Array(pointCount()).fill(null);
  for (let i = 0; i < allLost.length; i++) {
    const sampled = visible.filter((s) => (s.points[i] ?? -1) >= 0);
    if (sampled.length > 0 && sampled.every((s) => s.points[i] === 0)) allLost[i] = c.y_max;
  }
  const lines: Record<string, unknown>[] = [];
  const dots: (Record<string, unknown> | null)[] = [];
  for (const s of visible) {
    const color = props.latencyColor(s.id);
    let last = 0;
    const timeouts = s.points.map((v, i) => {
      if (v > 0) last = v;
      return v === 0 && allLost[i] === null ? last || c.y_max * 0.04 : null;
    });
    const values = s.points.map(gap);
    dots.push(loneDots(s.id, values, color));
    lines.push({
      id: `line:${s.id}`,
      name: s.id,
      type: "line",
      data: values,
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 1.25, color },
      itemStyle: { color },
      areaStyle: { color: area(color, 0.18) },
      emphasis: { disabled: true },
      z: 3,
    });
    if (!anyPoint(timeouts)) continue;
    dots.push({
      id: `__timeout__${s.id}`,
      name: `__timeout__${s.id}`,
      type: "scatter",
      data: timeouts,
      symbolSize: 5,
      itemStyle: { color: PING_TIMEOUT_COLOR, borderColor: color, borderWidth: 1.5 },
      tooltip: { show: false },
      silent: true,
      z: 4,
    });
  }
  const out: Record<string, unknown>[] = [...lines, ...dots.filter((d): d is Record<string, unknown> => d !== null)];
  if (!anyPoint(allLost)) return out;
  return [
    ...out,
    {
      id: "__lost__",
      name: "__lost__",
      type: "bar",
      data: allLost,
      barWidth: "60%",
      itemStyle: { color: alpha(PING_TIMEOUT_COLOR, 0.35) },
      tooltip: { show: false },
      silent: true,
      z: 1,
    },
  ];
}

function trafficSeries() {
  return traffic.value!.series
    .filter((s) => !hidden.value.has(s.name))
    .flatMap((s) => {
      const color = props.trafficColor(s.name);
      const down = s.download.map((v) => (v < 0 ? null : v));
      const lone = loneDots(`${s.name}↓`, down, color);
      return [
        ...(lone ? [lone] : []),
        {
          id: `down:${s.name}`,
          name: `${s.name} ↓`,
          type: "line",
          data: down,
          showSymbol: false,
          lineStyle: { width: 1.25, color },
          itemStyle: { color },
          areaStyle: { color: area(color, 0.2) },
          emphasis: { disabled: true },
          z: 3,
        },
        {
          id: `up:${s.name}`,
          name: `${s.name} ↑`,
          type: "line",
          data: s.upload.map((v) => (v < 0 ? null : v)),
          showSymbol: false,
          lineStyle: { width: 1, color, opacity: 0.65, type: "dashed" },
          itemStyle: { color },
          areaStyle: { color: area(color, 0.08) },
          emphasis: { disabled: true },
          z: 2,
        },
      ];
    });
}

// Go names profile routes "Route 2 (PTP)"; say it in the UI language.
function displayLabel(label: string) {
  const m = /^Route (\d+) \((.*)\)$/.exec(label);
  return m ? `${t("$vuetify.networkLatency.routeN", localDigits(m[1]))} (${m[2]})` : label;
}

function speedAxisLabel(v: number, max: number) {
  if (v <= 0) return localDigits(0);
  if (max >= 1024 * 1024) return `${localDigits(+(v / 1024 / 1024).toFixed(1))} ${speedUnit(2)}`;
  if (max >= 1024) return `${localDigits(Math.round(v / 1024))} ${speedUnit(1)}`;
  return `${localDigits(v)} ${speedUnit(0)}`;
}

function networkTag(network?: string) {
  if (!network) return "";
  return `<span style="font-size:9px;font-weight:600;margin-left:6px;color:${networkColor(network)}">${network.toUpperCase()}</span>`;
}

function tooltip(params: any[]) {
  const c = view.value === "latency" ? latency.value : traffic.value;
  const idx = params[0]?.dataIndex;
  if (!c || idx === undefined) return "";
  const at = formatTimeOfDay(new Date(c.end - (pointCount() - 1 - idx) * c.step));
  const shown = params.filter((p) => !String(p.seriesName).startsWith("__"));
  const row = (marker: string, name: string, value: string) =>
    `<div style="display:flex;gap:12px;justify-content:space-between"><span>${marker}${name}</span><span>${value}</span></div>`;
  if (view.value !== "latency") {
    const rows = shown.map((p) => row(p.marker, p.seriesName, p.value === null || p.value === undefined ? "—" : useHumanSpeed(p.value)));
    return `<div style="opacity:.6;margin-bottom:4px">${at}</div>${rows.join("")}`;
  }
  const byId = new Map(shown.map((p) => [p.seriesName as string, p]));
  const ch = chrome();
  const atMs = c.end - (pointCount() - 1 - idx) * c.step;
  const blocks = legendGroups.value.map((group) => {
    const rows = group.items
      .filter((item) => byId.has(item.id))
      .map((item) => {
        const p = byId.get(item.id)!;
        const s = latency.value?.series.find((x) => x.id === item.id);
        // Each ping is named by the path it was on then, not the line's
        // current one; a route that did not exist yet is left out.
        const then = s ? pathAt(s, atMs) : null;
        const hasValue = p.value !== null && p.value !== undefined;
        // A 0 point is a lost probe; -1 is simply no sample.
        const timedOut = s?.points[idx] === 0;
        const notThere = !then || atMs < (s?.paths?.[0]?.at ?? 0);
        if (s?.paths?.length && !hasValue && !timedOut && notThere) return "";
        const value = timedOut
          ? `<span style="color:${PING_TIMEOUT_COLOR}">${t("$vuetify.networkLatency.timeout")}</span>`
          : hasValue
            ? formatMs(p.value)
            : "—";
        const name = then ? pathName(then.pathKey) : item.label;
        return row(p.marker, `${name}${networkTag(then?.network ?? item.network)}`, value);
      })
      .filter(Boolean);
    if (rows.length === 0) return "";
    const head = group.iface ? `<div style="color:${ch.muted};font-size:11px;margin-top:4px">${group.iface}</div>` : "";
    return head + rows.join("");
  });
  return `<div style="opacity:.6;margin-bottom:2px">${at}</div>${blocks.join("")}`;
}

function option() {
  const ch = chrome();
  const isLatency = view.value === "latency";
  const c = isLatency ? latency.value! : traffic.value!;
  const series = isLatency ? latencySeries() : trafficSeries();
  const length = pointCount();
  const yMax = c.y_max;
  return {
    animation: false,
    textStyle: { fontFamily: chartFontFamily() },
    grid: { left: isLatency ? GRID_LEFT_LATENCY : GRID_LEFT_TRAFFIC, right: GRID_RIGHT, top: GRID_Y, bottom: GRID_Y },
    xAxis: {
      type: "category",
      data: Array.from({ length }, (_, i) => i),
      boundaryGap: false,
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: yMax,
      interval: yMax / (isLatency ? 5 : 4),
      axisLabel: {
        fontSize: 9,
        color: ch.muted,
        formatter: (v: number) => (isLatency ? localDigits(v) : speedAxisLabel(v, yMax)),
      },
      splitLine: { lineStyle: { type: "dashed", opacity: 0.22 } },
    },
    tooltip: {
      trigger: "axis",
      // In the chart's own DOM ECharts re-reads the container style on every
      // update (getComputedStyle); on <body> it never has to.
      appendTo: "body",
      axisPointer: { type: "line" },
      backgroundColor: ch.bg,
      borderColor: ch.border,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: ch.text, fontSize: 12, fontFamily: chartFontFamily() },
      extraCssText: `border-radius:8px;box-shadow:${ch.shadow};pointer-events:none;`,
      transitionDuration: 0,
      confine: true,
      formatter: tooltip,
    },
    series,
  };
}

// Axes/tooltip are rebuilt only when the layout changes; ticks push series data.
let layoutKey = "";
function currentLayoutKey() {
  const c = view.value === "latency" ? latency.value : traffic.value;
  const series = legend.value.filter((s) => s.visible).map((s) => s.id);
  return [view.value, theme.current.value.dark, formatLocale.value, c?.y_max, c?.step, pointCount(), ...series].join("|");
}

// A hidden window paints nothing; catch up once it is visible again.
let staleWhileHidden = false;
function onVisibility() {
  if (!document.hidden && staleWhileHidden) {
    staleWhileHidden = false;
    render();
  }
}

function render() {
  if (!chartEl.value || !hasData.value) return;
  if (document.hidden) {
    staleWhileHidden = true;
    return;
  }
  if (!instance) {
    // Dirty-rect leaves the WebView canvas blank until the pointer moves.
    instance = quietChart(echarts.init(chartEl.value, null, { useDirtyRect: false }));
    resizeObserver = new ResizeObserver(() => instance?.resize());
    resizeObserver.observe(chartEl.value);
    layoutKey = "";
  }
  const key = currentLayoutKey();
  if (key !== layoutKey) {
    layoutKey = key;
    instance.setOption(option(), { notMerge: true, lazyUpdate: false });
    return;
  }
  // replaceMerge by id: overlays that emptied out are removed, not left stale.
  instance.setOption(
    { series: view.value === "latency" ? latencySeries() : trafficSeries() },
    { replaceMerge: ["series"], lazyUpdate: false }
  );
}

const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | null = null;
watch(
  () => props.sessionStart > 0,
  (on) => {
    if (clock) clearInterval(clock);
    clock = on ? setInterval(() => (now.value = Date.now()), 1000) : null;
  },
  { immediate: true }
);
onBeforeUnmount(() => clock && clearInterval(clock));

const sessionElapsed = computed(() => {
  if (!props.sessionStart) return "";
  const s = Math.max(0, Math.floor((now.value - props.sessionStart) / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
});

function dispose() {
  resizeObserver?.disconnect();
  resizeObserver = null;
  instance?.dispose();
  instance = null;
}

watch([latency, traffic, view, hidden, () => theme.current.value.dark], () => nextTick(render));
watch(hasData, (has) => !has && dispose());
onMounted(() => {
  document.addEventListener("visibilitychange", onVisibility);
  nextTick(render);
});
onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", onVisibility);
  dispose();
});
</script>

<template>
  <div>
    <div v-if="!compact" class="live-chart__header mb-3">
      <div class="live-chart__controls">
        <div v-if="!fixedView" class="chart-view-tabs" role="tablist">
          <button
            v-for="v in (['latency', 'traffic'] as const)"
            :key="v"
            type="button"
            role="tab"
            class="chart-view-tab"
            :class="{ 'chart-view-tab--active': view === v }"
            :aria-selected="view === v"
            @click="selectView(v)"
          >
            {{ t(`$vuetify.networkLatency.${v}`) }}
          </button>
        </div>
        <v-select
          v-if="!fixedView"
          :model-value="range"
          :items="rangeItems"
          density="compact"
          variant="plain"
          hide-details
          single-line
          class="chart-range-select"
          @update:model-value="(r: string) => emit('update:range', r)"
        />
        <span v-if="sessionElapsed" class="live-chart__session text-caption">
          {{ t("$vuetify.networkLatency.session") }} {{ localDigits(sessionElapsed) }}
        </span>
      </div>

      <div class="chart-header-legend">
        <div v-for="group in legendGroups" :key="group.iface" class="chart-header-legend__group">
          <span v-if="group.iface" class="chart-header-legend__iface">{{ group.iface }}</span>
          <button
            v-for="item in group.items"
            :key="item.id"
            type="button"
            class="chart-header-legend__item"
            :class="{ 'chart-header-legend__item--hidden': !item.visible }"
            @click="toggle(item.id)"
          >
            <span class="chart-header-legend__dot" :style="{ backgroundColor: item.color }" />
            <span class="chart-header-legend__label">{{ item.label }}</span>
            <span v-if="item.network" class="chart-header-legend__net" :style="{ color: networkColor(item.network) }">
              {{ item.network.toUpperCase() }}
            </span>
          </button>
        </div>
      </div>
    </div>

    <div v-if="!hideStats && view === 'latency' && latency" class="live-chart__stats mb-3">
      <div>
        <div class="text-caption text-grey">{{ t("$vuetify.networkLatency.min") }}</div>
        <div class="text-body-2 font-weight-medium">{{ formatMs(latency.stats.min) }}</div>
      </div>
      <div>
        <div class="text-caption text-grey">{{ t("$vuetify.networkLatency.max") }}</div>
        <div class="text-body-2 font-weight-medium">{{ formatMs(latency.stats.max) }}</div>
      </div>
      <div>
        <div class="text-caption text-grey">{{ t("$vuetify.networkLatency.avg") }}</div>
        <div class="text-body-2 font-weight-medium">{{ formatMs(latency.stats.avg, "—", 1) }}</div>
      </div>
      <div>
        <div class="text-caption text-grey">{{ t("$vuetify.networkLatency.loss") }}</div>
        <div class="text-body-2 font-weight-medium">{{ localDigits(`${latency.stats.loss.toFixed(1)}%`) }}</div>
      </div>
    </div>

    <div v-else-if="!hideStats && view === 'traffic' && traffic" class="live-chart__stats mb-3">
      <div>
        <div class="text-caption text-grey">{{ t("$vuetify.network.download") }} · {{ t("$vuetify.networkLatency.avg") }}</div>
        <div class="text-body-2 font-weight-medium">{{ useHumanSpeed(traffic.stats.avg_download) }}</div>
      </div>
      <div>
        <div class="text-caption text-grey">{{ t("$vuetify.network.download") }} · {{ t("$vuetify.networkLatency.peak") }}</div>
        <div class="text-body-2 font-weight-medium">{{ useHumanSpeed(traffic.stats.peak_download) }}</div>
      </div>
      <div>
        <div class="text-caption text-grey">{{ t("$vuetify.network.upload") }} · {{ t("$vuetify.networkLatency.avg") }}</div>
        <div class="text-body-2 font-weight-medium">{{ useHumanSpeed(traffic.stats.avg_upload) }}</div>
      </div>
      <div>
        <div class="text-caption text-grey">{{ t("$vuetify.network.upload") }} · {{ t("$vuetify.networkLatency.peak") }}</div>
        <div class="text-body-2 font-weight-medium">{{ useHumanSpeed(traffic.stats.peak_upload) }}</div>
      </div>
    </div>

    <div v-if="hasData" class="live-chart__plot">
      <div ref="chartEl" :style="{ width: '100%', height: `${props.chartHeight}px` }" />
      <div v-if="pendingBand" class="live-chart__pending" :style="pendingBand" />
    </div>
    <div v-else class="text-center text-grey py-4">
      <v-icon icon="mdi-chart-line-variant" size="large" class="mb-2" />
      <div class="text-caption">{{ t("$vuetify.networkLatency.noData") }}</div>
    </div>
  </div>
</template>

<style scoped>
.live-chart__plot {
  position: relative;
}

.live-chart__pending {
  position: absolute;
  pointer-events: none;
  background: rgba(var(--v-theme-on-surface), 0.045);
}

.live-chart__header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.live-chart__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.live-chart__stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.live-chart__session {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.chart-range-select {
  flex: 0 0 auto;
  width: 64px;
  font-size: 0.75rem;
}

.chart-range-select :deep(.v-field) {
  --v-field-padding-start: 4px;
  --v-field-padding-end: 0;
  font-size: 0.75rem;
}

.chart-range-select :deep(.v-field__input) {
  opacity: 0.85;
  padding-top: 0;
  padding-bottom: 0;
  min-height: 28px;
}

.chart-range-select :deep(.v-field__append-inner) {
  opacity: 0.55;
  padding-top: 0;
}

.chart-view-tabs {
  display: inline-flex;
  gap: 6px;
}

.chart-view-tab {
  cursor: pointer;
  border: 2px solid rgba(var(--v-theme-on-surface), 0.22);
  border-radius: 999px;
  background: transparent;
  padding: 4px 14px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.75rem;
  line-height: 1.2;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
}

.chart-view-tab--active {
  border-color: rgba(var(--v-theme-on-surface), 0.38);
  background: rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-weight: 600;
}

.chart-header-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px 14px;
}

.chart-header-legend__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  border: none;
  background: transparent;
  padding: 0;
  color: rgba(var(--v-theme-on-surface), 0.72);
}

.chart-header-legend__item--hidden {
  opacity: 0.4;
}

.chart-header-legend__dot {
  border-radius: 50%;
  width: 8px;
  height: 8px;
}

.chart-header-legend__label {
  font-size: 0.72rem;
  white-space: nowrap;
}

/* One adapter's routes together, its name first. */
.chart-header-legend__group {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
}

.chart-header-legend__iface {
  font-size: 0.68rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.chart-header-legend__net {
  font-size: 0.6rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}
</style>
