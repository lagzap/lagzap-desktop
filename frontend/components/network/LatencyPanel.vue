<script lang="ts" setup>
import { ref, computed, nextTick, watch, onMounted, onUnmounted, toRef } from "vue";
import * as echarts from "echarts";
import {
  computeBestEnvelope,
  isPingTimeout,
  PING_TIMEOUT_MS,
  CHART_DISPLAY_SLOTS,
  CHART_DISPLAY_SLOTS_SMALL,
  CHART_TIME_RANGE_SECONDS,
  CHART_TIME_RANGE_OPTIONS,
  CHART_WINDOW_SECONDS_SMALL,
  PING_BAR_COLOR,
  PING_TIMEOUT_COLOR,
  colorForChartSeries,
  interfaceBaseColor,
  ifaceIndexInOrder,
  parseSeriesInterfaceKey,
  uniqueInterfaceOrder,
  alignPerInterfaceSpeedToPingWindow,
  useLatencyMetrics,
  getLossAccent,
  computeRouteProtectionInsight,
  type ChartTimeRange,
  type MultiInterfaceLatency,
} from "~/composables/useLatencyMetrics";
import type { NetworkSpeedPoint } from "~/types/monitoring";
import { useLocale, useTheme } from "vuetify";
import type { LatencyPingCache } from "~/composables/pingChartCache";

const props = withDefaults(
  defineProps<{
    latency?: MultiInterfaceLatency | null;
    active?: boolean;
    chartHeight?: number;
    hideHeader?: boolean;
    showLegend?: boolean;
    showSummaryMetrics?: boolean;
    showNetworkSpeed?: boolean;
    networkSpeedHistory?: NetworkSpeedPoint[];
    compact?: boolean;
    denseTimeRange?: boolean;
    /** `bars` = default overview; `lines` = per-route lines with usage area behind */
    chartVariant?: "bars" | "lines";
    pingCache?: LatencyPingCache;
    /** One probe sample per chart slot (route probes ~1/sec). */
    rollingSamples?: boolean;
    /** Probe cadence; route watchers emit ~1/sec. */
    probeSamplesPerSecond?: number;
    /** Shield tooltip when multipath absorbed path loss / lag-fix helped. */
    showProtectionInsight?: boolean;
  }>(),
  {
    active: true,
    chartHeight: 150,
    hideHeader: false,
    showLegend: false,
    showSummaryMetrics: true,
    showNetworkSpeed: false,
    networkSpeedHistory: () => [],
    compact: false,
    denseTimeRange: false,
    chartVariant: "bars",
    rollingSamples: false,
    probeSamplesPerSecond: 2,
    showProtectionInsight: false,
  }
);

const chartTimeRange = ref<ChartTimeRange>("1m");
const chartFrameTick = ref(0);
let chartFrameTimer: ReturnType<typeof setInterval> | null = null;

const chartWindowSize = computed(() =>
  props.compact ? CHART_DISPLAY_SLOTS_SMALL : CHART_DISPLAY_SLOTS
);

const chartWindowSeconds = computed(() =>
  props.compact
    ? CHART_WINDOW_SECONDS_SMALL
    : CHART_TIME_RANGE_SECONDS[chartTimeRange.value]
);

const chartRef = ref<HTMLDivElement>();
let chartInstance: echarts.ECharts | null = null;
let hoverDataIndex: number | null = null;
let pointerInsideChart = false;
let renderTimer: ReturnType<typeof setTimeout> | null = null;
const CHART_RENDER_INTERVAL_MS = 1000;
const ROLLING_CHART_RENDER_INTERVAL_MS = 500;
let chartHasFullOption = false;
let tooltipCacheKey = "";
let tooltipCacheHtml = "";

function renderIntervalMs() {
  return props.rollingSamples
    ? ROLLING_CHART_RENDER_INTERVAL_MS
    : CHART_RENDER_INTERVAL_MS;
}

function chartRenderFingerprint() {
  const data = chartData.value;
  const ranked = data.rankedInterfaces;
  const lastSamples = ranked.map((name) => {
    const series = data.seriesData[name];
    return series?.[series.length - 1] ?? "";
  });
  return [
    ranked.length,
    ranked.join("\0"),
    lastSamples.join("|"),
    props.networkSpeedHistory?.length ?? 0,
    chartTimeRange.value,
  ].join("#");
}

function invalidateTooltipCache() {
  tooltipCacheKey = "";
  tooltipCacheHtml = "";
}
const { t } = useLocale();
const theme = useTheme();
const isDarkTheme = computed(() => theme.current.value.dark);

function chartTooltipChrome() {
  if (isDarkTheme.value) {
    return {
      backgroundColor: "rgba(18, 18, 18, 0.92)",
      borderColor: "rgba(255, 255, 255, 0.08)",
      textColor: "#fff",
      shadow: "0 8px 24px rgba(0,0,0,0.35)",
      labelMuted: "#888",
      label: "#bbb",
      section: "#666",
      axisLabel: "#888",
    };
  }
  return {
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    borderColor: "rgba(0, 0, 0, 0.14)",
    textColor: "#171717",
    shadow: "0 8px 24px rgba(0,0,0,0.12)",
    labelMuted: "#6B6B6B",
    label: "#3A3A3A",
    section: "#5C5C5C",
    axisLabel: "#5C5C5C",
  };
}
const hiddenInterfaces = ref<Set<string>>(new Set());

const CHART_Y_MIN = 0;
const CHART_Y_DEFAULT_MAX = 500;
const CHART_Y_EXPANDED_MAX = PING_TIMEOUT_MS;
const SPEED_DOWNLOAD_STACK = "speed";
const SPEED_AREA_OPACITY = 0.72;
/** Soft fill behind profile latency lines — per-NIC color. */
const SPEED_BACKGROUND_OPACITY = 0.42;
const ROUTE_LINE_WIDTH = 1;
const LATENCY_STACK = "latency";
const PING_BAR_OPACITY = 0.9;
const BAND_BAR_OPACITY = 0.58;
const TIMEOUT_BAR_OPACITY = 0.92;
const BAR_CATEGORY_GAP = "6%";
const BAR_WIDTH = "92%";

function isLinesChart() {
  return props.chartVariant === "lines";
}

function formatSpeedAxisLabel(bytesPerSec: number) {
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(0)} MB/s`;
  }
  if (bytesPerSec >= 1024) {
    return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  }
  return `${bytesPerSec} B/s`;
}

function getSpeedInterfaceColor(name: string) {
  if (chartData.value.speedInterfaceColors[name]) {
    return chartData.value.speedInterfaceColors[name];
  }

  const ifaceOrder = uniqueInterfaceOrder(chartData.value.rankedInterfaces);
  const { iface } = parseSeriesInterfaceKey(name);
  return interfaceBaseColor(iface, ifaceIndexInOrder(iface, ifaceOrder));
}

function getPingInterfaceColor(name: string) {
  if (chartData.value.interfaceColors[name]) {
    return chartData.value.interfaceColors[name];
  }

  return colorForChartSeries(
    name,
    uniqueInterfaceOrder(chartData.value.rankedInterfaces)
  );
}

function getSpeedInterfaceNames() {
  // Prefer bare NIC names from traffic history (overview-style). Fall back to
  // unique ifaces parsed from route series keys (`Ethernet::0` → `Ethernet`).
  const fromHistory = new Set<string>();
  props.networkSpeedHistory.forEach((point) => {
    Object.keys(point.interfaces ?? {}).forEach((name) => {
      if (name && name !== "traffic") {
        fromHistory.add(name);
      }
    });
  });
  if (fromHistory.size > 0) {
    return [...fromHistory];
  }
  return uniqueInterfaceOrder(chartData.value.rankedInterfaces);
}

function isSpeedInterfaceVisible(ifaceName: string) {
  if (isInterfaceVisible(ifaceName)) {
    return true;
  }
  const matched = chartData.value.rankedInterfaces.some((key) => {
    const { iface } = parseSeriesInterfaceKey(key);
    return iface === ifaceName && isInterfaceVisible(key);
  });
  if (matched) {
    return true;
  }
  // Speed history keyed as "Default" (or a NIC not in route keys) still plots
  // when any latency series is visible.
  const latencyIfaces = uniqueInterfaceOrder(chartData.value.rankedInterfaces);
  if (latencyIfaces.length === 0) {
    return true;
  }
  return (
    !latencyIfaces.includes(ifaceName) && getVisibleInterfaces().length > 0
  );
}

function getAlignedSpeedData() {
  const length = chartData.value.times.length;

  if (!props.showNetworkSpeed || props.networkSpeedHistory.length === 0) {
    return {
      downloadByInterface: {} as Record<string, (number | null)[]>,
      uploadByInterface: {} as Record<string, (number | null)[]>,
      interfaceNames: [] as string[],
    };
  }

  return alignPerInterfaceSpeedToPingWindow(
    props.networkSpeedHistory,
    length,
    chartWindowSeconds.value
  );
}

function getSpeedYMax() {
  const { downloadByInterface, uploadByInterface } = getAlignedSpeedData();
  const visibleNames = getSpeedInterfaceNames().filter(isSpeedInterfaceVisible);
  let max = 0;

  for (let index = 0; index < chartData.value.times.length; index++) {
    let downloadTotal = 0;
    let uploadTotal = 0;

    visibleNames.forEach((name) => {
      downloadTotal += downloadByInterface[name]?.[index] ?? 0;
      uploadTotal += uploadByInterface[name]?.[index] ?? 0;
    });

    max = Math.max(max, downloadTotal + uploadTotal, downloadTotal, uploadTotal);
  }

  if (max === 0) {
    return 1024 * 1024;
  }

  const unit = max >= 1024 * 1024 ? 1024 * 1024 : 1024;
  return Math.ceil((max * 1.2) / unit) * unit;
}

function toStackedAreaData(values: (number | null | undefined)[]) {
  // Do not carry stale peaks across empty slots — that creates a growing
  // filled wedge that then "shrinks" as the window slides on each update.
  return values.map((value) => {
    if (value !== null && value !== undefined && value > 0) {
      return value;
    }
    return 0;
  });
}

function buildSpeedBackgroundSeries() {
  const { downloadByInterface, uploadByInterface } = getAlignedSpeedData();
  const ifaceOrder = uniqueInterfaceOrder([
    ...chartData.value.rankedInterfaces,
    ...getSpeedInterfaceNames(),
  ]);
  const visibleNames = getSpeedInterfaceNames().filter(isSpeedInterfaceVisible);

  return visibleNames.map((name) => {
    const color = interfaceBaseColor(
      name,
      ifaceIndexInOrder(name, ifaceOrder)
    );
    const download = downloadByInterface[name] ?? [];
    const upload = uploadByInterface[name] ?? [];
    const combined = download.map((down, index) => {
      const total = (down ?? 0) + (upload[index] ?? 0);
      return total > 0 ? total : null;
    });

    return {
      name: `__speed__${name}`,
      type: "line",
      stack: SPEED_DOWNLOAD_STACK,
      yAxisIndex: 1,
      data: toStackedAreaData(combined),
      smooth: false,
      showSymbol: false,
      connectNulls: false,
      triggerLineEvent: false,
      tooltip: { show: false },
      lineStyle: {
        width: 0,
        opacity: 0,
      },
      areaStyle: {
        color,
        opacity: SPEED_BACKGROUND_OPACITY,
      },
      emphasis: {
        disabled: true,
      },
      blur: {
        areaStyle: {
          opacity: SPEED_BACKGROUND_OPACITY,
        },
        lineStyle: {
          opacity: 0,
        },
      },
      silent: true,
      z: 1,
    };
  });
}

function buildSpeedSeries() {
  if (!props.showNetworkSpeed) {
    return [];
  }

  if (props.chartVariant === "lines") {
    return buildSpeedBackgroundSeries();
  }

  const { downloadByInterface } = getAlignedSpeedData();
  const visibleNames = getSpeedInterfaceNames().filter(isSpeedInterfaceVisible);

  return visibleNames.map((name, index) => {
    const color = getSpeedInterfaceColor(name);
    const layerOpacity = Math.min(
      0.9,
      SPEED_AREA_OPACITY + index * 0.06
    );

    return {
      name: `__speed__${name}`,
      type: "line",
      stack: SPEED_DOWNLOAD_STACK,
      yAxisIndex: 1,
      data: toStackedAreaData(downloadByInterface[name] ?? []),
      smooth: false,
      showSymbol: false,
      connectNulls: false,
      lineStyle: {
        width: 1.5,
        color,
        opacity: 0.95,
      },
      areaStyle: {
        color,
        opacity: layerOpacity,
      },
      emphasis: {
        disabled: true,
      },
      z: 2,
    };
  });
}

function buildYAxis() {
  const pingBounds = isLinesChart()
    ? { min: CHART_Y_MIN, max: CHART_Y_DEFAULT_MAX }
    : { min: CHART_Y_MIN, max: getChartYMax() };
  const chrome = chartTooltipChrome();

  const latencyAxis = {
    type: "value" as const,
    min: pingBounds.min,
    max: pingBounds.max,
    inverse: props.showNetworkSpeed && props.chartVariant === "bars",
    axisLabel: {
      fontSize: 9,
      color: chrome.axisLabel,
      formatter: (value: number) => `${value}`,
    },
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { show: false },
    scale: false,
  };

  if (!props.showNetworkSpeed) {
    return latencyAxis;
  }

  return [
    latencyAxis,
    {
      type: "value" as const,
      min: 0,
      max: getSpeedYMax(),
      position: "right" as const,
      axisLabel: {
        fontSize: 9,
        color: chrome.axisLabel,
        formatter: (value: number) => formatSpeedAxisLabel(value),
      },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      scale: false,
    },
  ];
}

function getVisibleInterfaces() {
  return chartData.value.rankedInterfaces.filter(isInterfaceVisible);
}

function getVisibleEnvelope() {
  const visible = getVisibleInterfaces();
  if (visible.length === 0) {
    return {
      bestSeries: chartData.value.bestSeries,
      interfaceBands: chartData.value.interfaceBands,
    };
  }

  return computeBestEnvelope(
    chartData.value.seriesData,
    visible,
    chartData.value.times.length
  );
}

function getChartPingBounds() {
  let minPing = Infinity;
  let maxPing = 0;

  getVisibleInterfaces().forEach((name) => {
    chartData.value.seriesData[name]?.forEach((value, index) => {
      if (value === null || value === undefined) {
        return;
      }
      if (isInterfaceSlotTimeout(index, name, value)) {
        return;
      }
      minPing = Math.min(minPing, value);
      maxPing = Math.max(maxPing, value);
    });
  });

  if (!Number.isFinite(minPing) || maxPing <= 0) {
    return { min: 0, max: 100 };
  }

  const range = Math.max(maxPing - minPing, 10);
  const padding = Math.max(4, range * 0.12);

  return {
    min: Math.max(0, Math.floor(minPing - padding)),
    max: Math.ceil(maxPing + padding),
  };
}

function getChartYMax() {
  if (props.chartVariant === "lines") {
    return getChartPingBounds().max;
  }

  const { bestSeries } = getVisibleEnvelope();
  const hasTimeouts = chartData.value.timeoutBars.some((failures) =>
    failures.some((failure) => isInterfaceVisible(failure.interfaceName))
  );

  let maxPing = 0;
  bestSeries.forEach((best) => {
    if (best !== null && !isPingTimeout(best)) {
      maxPing = Math.max(maxPing, best);
    }
  });

  if (!hasTimeouts && maxPing <= CHART_Y_DEFAULT_MAX) {
    return CHART_Y_DEFAULT_MAX;
  }

  return CHART_Y_EXPANDED_MAX;
}

function isIndexTimeout(axisIndex: number, best: number | null | undefined) {
  // Keep a successful best bar green; only paint a full red timeout bar when
  // nothing usable landed in this slot for the visible interfaces.
  if (best !== null && best !== undefined && !isPingTimeout(best)) {
    return false;
  }
  return (chartData.value.timeoutBars[axisIndex] ?? []).some(
    (failure) => isInterfaceVisible(failure.interfaceName)
  );
}

function isInterfaceSlotTimeout(
  axisIndex: number,
  interfaceName: string,
  value: number | null | undefined
) {
  const timedOut = (chartData.value.timeoutBars[axisIndex] ?? []).some(
    (failure) =>
      failure.interfaceName === interfaceName &&
      isInterfaceVisible(failure.interfaceName)
  );
  if (timedOut) {
    return true;
  }

  return value !== null && value !== undefined && isPingTimeout(value, true);
}

function buildLatencyBarSeries() {
  const { bestSeries, interfaceBands } = getVisibleEnvelope();
  const visible = getVisibleInterfaces();
  const yMax = getChartYMax();

  const bestData = bestSeries.map((value, index) => {
    if (value === null || value === undefined) {
      if (!isIndexTimeout(index, value)) {
        return null;
      }

      return {
        value: yMax,
        itemStyle: {
          color: PING_TIMEOUT_COLOR,
          opacity: TIMEOUT_BAR_OPACITY,
          borderWidth: 0,
        },
      };
    }

    if (isIndexTimeout(index, value)) {
      return {
        value: yMax,
        itemStyle: {
          color: PING_TIMEOUT_COLOR,
          opacity: TIMEOUT_BAR_OPACITY,
          borderWidth: 0,
        },
      };
    }

    return {
      value,
      itemStyle: {
        color: PING_BAR_COLOR,
        opacity: PING_BAR_OPACITY,
        borderWidth: 0,
      },
    };
  });

  const baseSeries = {
    name: "__best__",
    type: "bar",
    stack: LATENCY_STACK,
    yAxisIndex: 0,
    data: bestData,
    barCategoryGap: BAR_CATEGORY_GAP,
    barWidth: BAR_WIDTH,
    barMinHeight: 0,
    emphasis: {
      disabled: true,
    },
    z: 5,
  };

  const bandSeries = visible.map((name) => ({
    name,
    type: "bar",
    stack: LATENCY_STACK,
    yAxisIndex: 0,
    data: (chartData.value.seriesData[name] ?? []).map((value, index) => {
      if (isInterfaceSlotTimeout(index, name, value)) {
        const best = bestSeries[index];
        if (best === null || best === undefined) {
          return null;
        }

        return {
          value: Math.max(0, yMax - best),
          itemStyle: {
            color: PING_TIMEOUT_COLOR,
            opacity: TIMEOUT_BAR_OPACITY,
            borderWidth: 0,
          },
        };
      }

      const delta = interfaceBands[name]?.[index];
      if (delta === null || delta === undefined || delta <= 0) {
        return null;
      }

      return {
        value: delta,
        itemStyle: {
          color: chartData.value.interfaceColors[name],
          opacity: BAND_BAR_OPACITY,
          borderColor: chartData.value.interfaceColors[name],
          borderWidth: 1,
        },
      };
    }),
    emphasis: {
      disabled: true,
    },
    z: 4,
  }));

  return [baseSeries, ...bandSeries];
}

function buildLatencyLineSeries() {
  const visible = getVisibleInterfaces();

  return visible.map((name, index) => {
    const color =
      chartData.value.interfaceColors[name] ??
      colorForChartSeries(
        name,
        uniqueInterfaceOrder(chartData.value.rankedInterfaces)
      );
    const timeoutMarks: Array<{
      coord: [number, number];
      symbol: string;
      symbolSize: number;
      symbolRotate?: number;
      itemStyle: { color: string };
    }> = [];
    const data = chartData.value.times.map((_, slotIndex) => {
      const value = chartData.value.seriesData[name]?.[slotIndex];
      if (value === null || value === undefined) {
        if (isInterfaceSlotTimeout(slotIndex, name, value)) {
          timeoutMarks.push({
            coord: [slotIndex, CHART_Y_DEFAULT_MAX],
            symbol: "diamond",
            symbolSize: 7,
            itemStyle: { color: PING_TIMEOUT_COLOR },
          });
        }
        return null;
      }
      if (
        isInterfaceSlotTimeout(slotIndex, name, value) ||
        value >= CHART_Y_DEFAULT_MAX
      ) {
        timeoutMarks.push({
          coord: [slotIndex, CHART_Y_DEFAULT_MAX],
          symbol: "diamond",
          symbolSize: 7,
          itemStyle: { color: PING_TIMEOUT_COLOR },
        });
        return null;
      }
      return value;
    });

    return {
      name,
      type: "line",
      yAxisIndex: 0,
      data,
      smooth: false,
      showSymbol: false,
      connectNulls: false,
      lineStyle: {
        width: ROUTE_LINE_WIDTH,
        color,
        opacity: 0.95,
      },
      itemStyle: {
        color,
      },
      markPoint:
        timeoutMarks.length > 0
          ? {
              data: timeoutMarks,
              animation: false,
              silent: true,
              label: { show: false },
            }
          : undefined,
      // Avoid focus/blur — it warps the usage area series into a solid wedge
      // under the cursor and leaves it stuck until the next data refresh.
      emphasis: {
        disabled: true,
      },
      z: 10 + index,
    };
  });
}

function buildChartSeries() {
  const latencySeries =
    props.chartVariant === "lines"
      ? buildLatencyLineSeries()
      : buildLatencyBarSeries();

  return [...buildSpeedSeries(), ...latencySeries];
}

const {
  allPings,
  combinedMetrics,
  chartData,
  interfaceLegend,
} = useLatencyMetrics(toRef(props, "latency"), {
  windowSize: chartWindowSize,
  windowSeconds: chartWindowSeconds,
  pingCache: computed(() => props.pingCache),
  rollingSamples: computed(() => props.rollingSamples),
  probeSamplesPerSecond: computed(() => props.probeSamplesPerSecond),
  chartTick: props.rollingSamples ? undefined : chartFrameTick,
});

/** Route pings or a time axis ready for the speed overlay (high-traffic). */
const hasChartData = computed(
  () =>
    allPings.value.length > 0 ||
    (props.showNetworkSpeed && chartData.value.times.length > 0)
);

const lossSummaryColor = computed(() => {
  const loss = combinedMetrics.value.loss || 0;
  if (loss <= 0) {
    return undefined;
  }
  return (
    getLossAccent(loss, isDarkTheme.value) ??
    (isDarkTheme.value ? "#EF5350" : "#C62828")
  );
});

const { lagFixHistory } = useMonitoringStore();

const protectionInsight = computed(() => {
  if (!props.showProtectionInsight || !props.latency?.interfaces) {
    return null;
  }
  return computeRouteProtectionInsight(props.latency.interfaces, {
    lagFixes: lagFixHistory.value ?? [],
    samplesPerSecond: props.probeSamplesPerSecond,
  });
});

const protectionTooltipBody = computed(() => {
  const insight = protectionInsight.value;
  if (!insight) {
    return "";
  }
  const worst = Math.round(insight.worstPathLoss);
  const effective = Math.round(insight.effectiveLoss);
  const windowSec = insight.windowSeconds;
  const interventions = insight.recentInterventions;

  // Vuetify t() rewrites {0} to "undefined" when called without args.
  // Locale strings use $0$, $1$, … which we fill here.
  const fill = (key: string, ...values: Array<string | number>) =>
    String(t(key)).replace(/\$(\d+)\$/g, (_, index) =>
      String(values[Number(index)] ?? "")
    );

  if (interventions > 0 && insight.worstPathLoss >= 8) {
    return fill(
      "$vuetify.networkLatency.lossProtectedHintWithFixes",
      interventions,
      worst,
      effective,
      windowSec
    );
  }
  if (interventions > 0) {
    return fill(
      "$vuetify.networkLatency.lossProtectedHintFixesOnly",
      interventions,
      effective
    );
  }
  return fill(
    "$vuetify.networkLatency.lossProtectedHint",
    worst,
    windowSec,
    effective
  );
});

const visibleInterfaceLegend = computed(() =>
  interfaceLegend.value.map((item) => ({
    ...item,
    visible: !hiddenInterfaces.value.has(item.name),
  }))
);

function isInterfaceVisible(name: string) {
  return !hiddenInterfaces.value.has(name);
}

function toggleInterface(name: string) {
  const next = new Set(hiddenInterfaces.value);
  if (next.has(name)) {
    next.delete(name);
  } else {
    next.add(name);
  }
  hiddenInterfaces.value = next;

  if (chartInstance) {
    renderChart();
  }
}

function buildLegendSelected(interfaceNames: string[]) {
  return Object.fromEntries(
    interfaceNames.map((name) => [name, isInterfaceVisible(name)])
  );
}

function seriesDisplayName(seriesKey: string) {
  const { iface, slot } = parseSeriesInterfaceKey(seriesKey);
  if (seriesKey.includes("::")) {
    return (
      props.latency?.interfaces?.[seriesKey]?.target_ip?.trim() ||
      `${iface} · ${slot + 1}`
    );
  }
  return iface;
}

function pingTargetTitle() {
  if (props.chartVariant === "lines") {
    return "";
  }
  const interfaces = props.latency?.interfaces;
  if (!interfaces) {
    return "";
  }
  for (const iface of Object.values(interfaces)) {
    const ip = iface?.target_ip?.trim();
    if (ip) {
      return ip;
    }
  }
  return props.latency?.ping_target?.trim() || "";
}

function truncateInterfaceName(name: string, maxLength = 14) {
  if (name.length <= maxLength) {
    return name;
  }
  return `${name.slice(0, maxLength - 1)}…`;
}

function tooltipRow(label: string, value: string, options?: { muted?: boolean }) {
  const chrome = chartTooltipChrome();
  const labelStyle = options?.muted
    ? `color:${chrome.labelMuted};font-size:11px`
    : `color:${chrome.label};font-size:11px`;
  return `<tr>
    <td style="padding:2px 10px 2px 0;white-space:nowrap;${labelStyle}">${label}</td>
    <td style="padding:2px 0;text-align:right;font-weight:500;white-space:nowrap">${value}</td>
  </tr>`;
}

function tooltipInterfaceRow(
  color: string,
  name: string,
  valueHtml: string,
  options?: { muted?: boolean }
) {
  const label = `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:5px;height:5px;border-radius:50%;background:${color};flex-shrink:0"></span>${truncateInterfaceName(seriesDisplayName(name))}</span>`;
  return tooltipRow(label, valueHtml, options);
}

function tooltipSection(title: string) {
  const chrome = chartTooltipChrome();
  return `<div style="padding:6px 0 3px;color:${chrome.section};font-size:10px;text-transform:uppercase;letter-spacing:0.04em">${title}</div>`;
}

function tooltipTable(rows: string[]) {
  if (rows.length === 0) {
    return "";
  }

  return `<table style="border-collapse:collapse;line-height:1.35;font-size:12px;width:100%">${rows.join("")}</table>`;
}

function formatLatencyValue(value: number) {
  return `${value}${t("$vuetify.ms")}`;
}

function formatTimeoutValue() {
  return `<span style="color:${PING_TIMEOUT_COLOR}">${t("$vuetify.networkLatency.timeout")}</span>`;
}

function formatTooltipSpeed(speedInBytes: number) {
  if (speedInBytes === 0) {
    return "0 B/s";
  }

  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  const unitIndex = Math.min(
    units.length - 1,
    Math.floor(Math.log(speedInBytes) / Math.log(1024))
  );
  const value = speedInBytes / 1024 ** unitIndex;
  const rounded =
    unitIndex === 0 || value >= 100
      ? Math.round(value)
      : Math.round(value * 10) / 10;

  return `${rounded} ${units[unitIndex]}`;
}

function formatInterfaceSpeedPair(down: number, up: number) {
  const parts: string[] = [];

  if (down > 0) {
    parts.push(`↓ ${formatTooltipSpeed(down)}`);
  }
  if (up > 0) {
    parts.push(`↑ ${formatTooltipSpeed(up)}`);
  }

  return parts.join("  ");
}

function formatTooltipContent(axisIndex: number) {
  const cacheKey = `${axisIndex}#${chartRenderFingerprint()}`;
  if (cacheKey === tooltipCacheKey && tooltipCacheHtml) {
    return tooltipCacheHtml;
  }

  const sections: string[] = [];
  const visible = getVisibleInterfaces();
  const timedOutNames = new Set(
    (chartData.value.timeoutBars[axisIndex] ?? [])
      .filter((failure) => isInterfaceVisible(failure.interfaceName))
      .map((failure) => failure.interfaceName)
  );

  const latencyRows: string[] = [];
  visible.forEach((interfaceName) => {
    const value = chartData.value.seriesData[interfaceName]?.[axisIndex];
    const color = getPingInterfaceColor(interfaceName);
    const timedOut =
      timedOutNames.has(interfaceName) ||
      (value !== null &&
        value !== undefined &&
        (isPingTimeout(value, true) ||
          (isLinesChart() && value >= CHART_Y_DEFAULT_MAX)));

    if (
      value !== null &&
      value !== undefined &&
      !timedOut &&
      !isPingTimeout(value, true)
    ) {
      latencyRows.push(
        tooltipInterfaceRow(color, interfaceName, formatLatencyValue(value))
      );
      return;
    }

    if (timedOut) {
      latencyRows.push(
        tooltipInterfaceRow(color, interfaceName, formatTimeoutValue())
      );
    }
  });

  if (latencyRows.length > 0) {
    sections.push(tooltipSection(t("$vuetify.networkLatency.latency")));
    sections.push(tooltipTable(latencyRows));
  }

  if (props.showNetworkSpeed) {
    const { downloadByInterface, uploadByInterface } = getAlignedSpeedData();
    const visibleNames = getSpeedInterfaceNames().filter(isSpeedInterfaceVisible);
    const speedRows: string[] = [];

    visibleNames.forEach((name) => {
      const down = downloadByInterface[name]?.[axisIndex] ?? 0;
      const up = uploadByInterface[name]?.[axisIndex] ?? 0;
      const speedLabel = formatInterfaceSpeedPair(down, up);

      if (!speedLabel) {
        return;
      }

      speedRows.push(
        tooltipInterfaceRow(getSpeedInterfaceColor(name), name, speedLabel)
      );
    });

    if (speedRows.length > 0) {
      sections.push(tooltipSection(t("$vuetify.networkLatency.speed")));
      sections.push(tooltipTable(speedRows));
    }
  }

  if (sections.length === 0) {
    tooltipCacheKey = cacheKey;
    tooltipCacheHtml = t("$vuetify.networkLatency.noData");
    return tooltipCacheHtml;
  }

  tooltipCacheKey = cacheKey;
  tooltipCacheHtml = `<div style="line-height:1.35;font-size:12px;min-width:180px;max-width:280px">${sections.join("")}</div>`;
  return tooltipCacheHtml;
}

function hideChartTooltip() {
  if (!chartInstance) {
    return;
  }

  chartInstance.dispatchAction({ type: "hideTip" });
}

function bindChartInteraction() {
  if (!chartInstance) {
    return;
  }

  chartInstance.off("updateAxisPointer");
  chartInstance.off("globalout");
  chartInstance.getZr().off("mousemove");

  chartInstance.on("updateAxisPointer", (event: any) => {
    let index: number | null = null;

    if (typeof event.dataIndex === "number") {
      index = event.dataIndex;
    } else {
      const axisValue = event.axesInfo?.[0]?.value;
      if (axisValue !== undefined && axisValue !== null) {
        const found = chartData.value.times.indexOf(axisValue);
        index = found >= 0 ? found : Math.round(Number(axisValue));
      }
    }

    if (index === null || Number.isNaN(index)) {
      return;
    }

    pointerInsideChart = true;
    hoverDataIndex = index;
  });

  chartInstance.getZr().on("mousemove", () => {
    pointerInsideChart = true;
  });

  chartInstance.on("globalout", () => {
    pointerInsideChart = false;
    hoverDataIndex = null;
    hideChartTooltip();
  });
}

function buildChartOption() {
  const chrome = chartTooltipChrome();
  return {
    animation: false,
    brush: {
      disabled: true,
    },
    toolbox: {
      show: false,
    },
    dataZoom: [],
    grid: {
      left: props.showNetworkSpeed ? 36 : 28,
      right: props.showNetworkSpeed ? 44 : 8,
      bottom: 8,
      top: 8,
      containLabel: false,
    },
    xAxis: {
      type: "category",
      data: chartData.value.times,
      boundaryGap: !isLinesChart(),
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: buildYAxis(),
    series: buildChartSeries(),
    legend: {
      show: false,
      data: getVisibleInterfaces(),
      selected: buildLegendSelected(getVisibleInterfaces()),
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "line",
        snap: true,
      },
      backgroundColor: chrome.backgroundColor,
      borderColor: chrome.borderColor,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: chrome.textColor, fontSize: 12 },
      extraCssText:
        `border-radius:8px;box-shadow:${chrome.shadow};`,
      formatter: (params: any) => {
        const dataIndex = params[0]?.dataIndex;
        if (dataIndex === undefined || dataIndex < 0) {
          return t("$vuetify.networkLatency.noData");
        }
        return formatTooltipContent(dataIndex);
      },
      enterable: true,
      hideDelay: 80,
      showDelay: 0,
      transitionDuration: 0,
      confine: true,
      alwaysShowContent: false,
    },
  };
}

function scheduleRenderChart() {
  if (renderTimer !== null) {
    return;
  }
  renderTimer = setTimeout(() => {
    renderTimer = null;
    renderChart();
  }, renderIntervalMs());
}

function ensureChartInstance() {
  if (!chartRef.value || chartInstance) {
    return;
  }

  chartInstance = echarts.init(chartRef.value, null, {
    useDirtyRect: true,
    useCoarsePointer: true,
    pointerSize: 4,
  });
  bindChartInteraction();
}

function buildChartDataOption() {
  return {
    xAxis: { data: chartData.value.times },
    yAxis: buildYAxis(),
    series: buildChartSeries(),
  };
}

function renderChart() {
  if (!chartRef.value || !props.active || !hasChartData.value) {
    return;
  }

  ensureChartInstance();
  if (!chartInstance) {
    return;
  }

  if (props.rollingSamples) {
    if (!chartHasFullOption) {
      invalidateTooltipCache();
      chartInstance.setOption(buildChartOption(), {
        replaceMerge: ["series", "yAxis", "xAxis"],
        lazyUpdate: true,
      });
      chartHasFullOption = true;
      return;
    }

    chartInstance.setOption(buildChartDataOption(), {
      replaceMerge: ["series", "yAxis", "xAxis"],
      lazyUpdate: true,
    });
    return;
  }

  // Always merge. notMerge:true on the lines chart was rebuilding the whole
  // option while the pointer was over it, which made the usage area fill jump
  // into a stuck wedge until the next realtime tick.
  // Rolling route charts must keep scrolling while hovered — only skip the
  // heavier full option rebuild for bar charts under an active hover.
  const isHovering =
    !props.rollingSamples &&
    pointerInsideChart &&
    hoverDataIndex !== null &&
    chartData.value.times.length > 0;

  if (isHovering) {
    chartInstance.setOption(buildChartDataOption(), {
      replaceMerge: ["series", "yAxis", "xAxis"],
      lazyUpdate: true,
    });
    return;
  }

  invalidateTooltipCache();
  chartInstance.setOption(buildChartOption(), {
    replaceMerge: ["series", "yAxis", "xAxis"],
    lazyUpdate: true,
  });
}

const initChart = async () => {
  if (!chartRef.value || !props.active) return;

  await nextTick();

  if (!hasChartData.value) {
    disposeChart();
    return;
  }

  if (!chartInstance) {
    ensureChartInstance();
  }

  renderChart();
};

const disposeChart = () => {
  if (renderTimer !== null) {
    clearTimeout(renderTimer);
    renderTimer = null;
  }
  chartHasFullOption = false;
  if (chartInstance) {
    chartInstance.dispose();
    chartInstance = null;
    hoverDataIndex = null;
    pointerInsideChart = false;
  }
};

const refreshChart = () => {
  if (!props.active) return;

  nextTick(() => {
    setTimeout(() => {
      if (hasChartData.value) {
        initChart();
        chartInstance?.resize();
      } else {
        disposeChart();
      }
    }, 100);
  });
};

function handleWindowResize() {
  chartInstance?.resize();
}

watch(
  chartRenderFingerprint,
  () => {
    if (props.active && hasChartData.value) {
      scheduleRenderChart();
    }
  }
);

watch(
  () => Object.keys(props.latency?.interfaces || {}).length,
  () => {
    hiddenInterfaces.value = new Set();
    if (props.active && hasChartData.value) {
      renderChart();
    }
  }
);

watch(
  () => chartTimeRange.value,
  () => {
    chartHasFullOption = false;
    if (props.active && hasChartData.value) {
      renderChart();
    }
  }
);

watch(isDarkTheme, () => {
  invalidateTooltipCache();
  chartHasFullOption = false;
  if (props.active && hasChartData.value) {
    renderChart();
  }
});

watch(hasChartData, (ready) => {
  if (props.active && ready) {
    refreshChart();
  } else if (!ready) {
    disposeChart();
  }
});

watch(
  () => props.active,
  (active) => {
    pointerInsideChart = false;
    hoverDataIndex = null;
    if (active) {
      refreshChart();
    } else {
      disposeChart();
    }
  }
);

onMounted(() => {
  if (!props.rollingSamples) {
    chartFrameTimer = setInterval(() => {
      chartFrameTick.value += 1;
    }, CHART_RENDER_INTERVAL_MS);
  }
  if (props.active) {
    refreshChart();
  }
  window.addEventListener("resize", handleWindowResize);
  document.addEventListener("visibilitychange", handleVisibilityChange);
});

onUnmounted(() => {
  if (chartFrameTimer !== null) {
    clearInterval(chartFrameTimer);
    chartFrameTimer = null;
  }
  window.removeEventListener("resize", handleWindowResize);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  disposeChart();
});

function handleVisibilityChange() {
  if (document.visibilityState !== "visible") {
    return;
  }
  pointerInsideChart = false;
  hoverDataIndex = null;
  if (props.active && hasChartData.value) {
    chartInstance?.resize();
    scheduleRenderChart();
  }
}
</script>

<template>
  <div>
    <div v-if="!hideHeader" class="d-flex align-center justify-space-between mb-3">
      <div>
        <span class="text-subtitle-1 font-weight-medium">
          {{ pingTargetTitle() || t("$vuetify.connections.latency") }}
        </span>
      </div>

      <v-btn-toggle
        v-if="!compact && hasChartData"
        v-model="chartTimeRange"
        density="compact"
        variant="outlined"
        divided
        mandatory
        :class="{ 'latency-time-range--dense': denseTimeRange }"
      >
        <v-btn
          v-for="range in CHART_TIME_RANGE_OPTIONS"
          :key="range"
          :value="range"
          :size="denseTimeRange ? 'x-small' : 'small'"
        >
          {{ range }}
        </v-btn>
      </v-btn-toggle>
    </div>

    <div v-if="showSummaryMetrics" class="d-flex flex-wrap gap-3 mb-3">
      <div class="flex-grow-1">
        <div class="text-caption text-grey">{{ t("$vuetify.networkLatency.min") }}</div>
        <div class="text-body-2 font-weight-medium">
          {{ combinedMetrics.min === Infinity ? 0 : combinedMetrics.min || 0 }}{{ t("$vuetify.ms") }}
        </div>
      </div>
      <div class="flex-grow-1">
        <div class="text-caption text-grey">{{ t("$vuetify.networkLatency.max") }}</div>
        <div class="text-body-2 font-weight-medium">
          {{ combinedMetrics.max || 0 }}{{ t("$vuetify.ms") }}
        </div>
      </div>
      <div class="flex-grow-1">
        <div class="text-caption text-grey">{{ t("$vuetify.networkLatency.avg") }}</div>
        <div class="text-body-2 font-weight-medium">
          {{ combinedMetrics.avg.toFixed(1) }}{{ t("$vuetify.ms") }}
        </div>
      </div>
      <div class="flex-grow-1">
        <div class="text-caption text-grey d-flex align-center ga-1">
          <span>{{ t("$vuetify.networkLatency.loss") }}</span>
          <v-tooltip
            v-if="protectionInsight"
            location="top"
            max-width="300"
            open-delay="200"
          >
            <template #activator="{ props: tipProps }">
              <button
                v-bind="tipProps"
                type="button"
                class="loss-protected-trigger"
                :aria-label="t('$vuetify.networkLatency.lossProtectedTitle')"
              >
                <v-icon
                  icon="mdi-shield-check"
                  size="14"
                  color="success"
                />
              </button>
            </template>
            <div class="loss-protected-tooltip">
              <div class="loss-protected-tooltip__title">
                {{ t("$vuetify.networkLatency.lossProtectedTitle") }}
              </div>
              <div class="loss-protected-tooltip__body">
                {{ protectionTooltipBody }}
              </div>
            </div>
          </v-tooltip>
        </div>
        <div
          class="text-body-2 font-weight-medium d-flex align-center ga-1"
          :style="combinedMetrics.loss > 0 ? { color: lossSummaryColor } : undefined"
        >
          <span>{{ Math.round(combinedMetrics.loss || 0) }}%</span>
          <span
            v-if="protectionInsight"
            class="loss-protected-chip"
          >
            {{ t("$vuetify.networkLatency.lossProtected") }}
          </span>
        </div>
      </div>
    </div>

    <div v-if="hasChartData">
      <div
        ref="chartRef"
        :style="{ width: '100%', height: `${chartHeight}px` }"
      />
      <div
        v-if="showLegend && visibleInterfaceLegend.length > 0"
        class="d-flex flex-wrap justify-center ga-3 mt-2"
      >
        <button
          v-for="item in visibleInterfaceLegend"
          :key="item.name"
          type="button"
          class="interface-legend-item"
          :class="{ 'interface-legend-item--hidden': !item.visible }"
          @click="toggleInterface(item.name)"
        >
          <span
            class="interface-legend-dot"
            :class="{ 'interface-legend-line': chartVariant === 'lines' }"
            :style="{ backgroundColor: item.color }"
          />
          <span
            class="interface-legend-label"
            :style="{ color: item.visible ? item.color : undefined }"
          >{{ item.label || item.name }}</span>
        </button>
      </div>
    </div>

    <div v-else class="text-center text-grey py-4">
      <v-icon icon="mdi-chart-line-variant" size="large" class="mb-2" />
      <div class="text-caption">{{ t("$vuetify.networkLatency.noPingData") }}</div>
    </div>
  </div>
</template>

<style scoped>
.interface-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: inherit;
}

.interface-legend-item--hidden {
  opacity: 0.45;
}

.interface-legend-item--hidden .interface-legend-dot {
  opacity: 0.35;
}

.interface-legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.interface-legend-line {
  width: 14px;
  height: 2px;
  border-radius: 1px;
}

.interface-legend-label {
  font-size: 0.75rem;
  line-height: 1;
}

.latency-time-range--dense :deep(.v-btn) {
  min-width: 36px;
  padding-inline: 8px;
  font-size: 0.7rem;
  letter-spacing: 0.02em;
  text-transform: lowercase;
}

.loss-protected-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  border: none;
  background: transparent;
  cursor: help;
  line-height: 1;
}

.loss-protected-chip {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(76, 175, 80, 0.16);
  color: #81c784;
  line-height: 1.35;
}

.loss-protected-tooltip__title {
  font-weight: 600;
  margin-bottom: 4px;
}

.loss-protected-tooltip__body {
  font-size: 12px;
  line-height: 1.4;
  opacity: 0.92;
}
</style>
