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
  PING_CHART_COLORS,
  INTERFACE_CHART_COLORS,
  PING_BAR_COLOR,
  PING_TIMEOUT_COLOR,
  SPEED_CHART_COLORS,
  chartColorAt,
  alignPerInterfaceSpeedToPingWindow,
  useLatencyMetrics,
  type ChartTimeRange,
  type MultiInterfaceLatency,
} from "~/composables/useLatencyMetrics";
import type { NetworkSpeedPoint } from "~/types/monitoring";
import { useLocale } from "vuetify";

const props = withDefaults(
  defineProps<{
    latency?: MultiInterfaceLatency | null;
    active?: boolean;
    chartHeight?: number;
    hideHeader?: boolean;
    showLegend?: boolean;
    showNetworkSpeed?: boolean;
    networkSpeedHistory?: NetworkSpeedPoint[];
    compact?: boolean;
    denseTimeRange?: boolean;
    /** `bars` = default overview; `lines` = per-route lines with usage area behind */
    chartVariant?: "bars" | "lines";
  }>(),
  {
    active: true,
    chartHeight: 150,
    hideHeader: false,
    showLegend: false,
    showNetworkSpeed: false,
    networkSpeedHistory: () => [],
    compact: false,
    denseTimeRange: false,
    chartVariant: "bars",
  }
);

const chartTimeRange = ref<ChartTimeRange>("1m");

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
const { t } = useLocale();
const hiddenInterfaces = ref<Set<string>>(new Set());

const CHART_Y_MIN = 0;
const CHART_Y_DEFAULT_MAX = 500;
const CHART_Y_EXPANDED_MAX = PING_TIMEOUT_MS;
const SPEED_DOWNLOAD_STACK = "speed";
const SPEED_AREA_OPACITY = 0.72;
const SPEED_BACKGROUND_OPACITY = 0.16;
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

  const index = Math.max(0, getSpeedInterfaceNames().indexOf(name));
  return chartColorAt(SPEED_CHART_COLORS, index);
}

function getPingInterfaceColor(name: string) {
  if (chartData.value.interfaceColors[name]) {
    return chartData.value.interfaceColors[name];
  }

  const index = Math.max(0, chartData.value.rankedInterfaces.indexOf(name));
  return chartColorAt(INTERFACE_CHART_COLORS, index);
}

function getSpeedInterfaceNames() {
  const names = new Set<string>();
  chartData.value.rankedInterfaces.forEach((name) => names.add(name));
  props.networkSpeedHistory.forEach((point) => {
    Object.keys(point.interfaces ?? {}).forEach((name) => names.add(name));
  });
  return [...names].sort();
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
  const { downloadByInterface, uploadByInterface, interfaceNames } =
    getAlignedSpeedData();
  let max = 0;

  for (let index = 0; index < chartData.value.times.length; index++) {
    let downloadTotal = 0;
    let uploadTotal = 0;

    interfaceNames.forEach((name) => {
      if (!isInterfaceVisible(name)) {
        return;
      }

      downloadTotal += downloadByInterface[name]?.[index] ?? 0;
      uploadTotal += uploadByInterface[name]?.[index] ?? 0;
    });

    max = Math.max(max, downloadTotal, uploadTotal);
  }

  if (max === 0) {
    return 1024 * 1024;
  }

  const unit = max >= 1024 * 1024 ? 1024 * 1024 : 1024;
  return Math.ceil((max * 1.2) / unit) * unit;
}

function toStackedAreaData(values: (number | null | undefined)[]) {
  let last = 0;
  return values.map((value) => {
    if (value !== null && value !== undefined && value > 0) {
      last = value;
    }
    return last;
  });
}

function buildSpeedBackgroundSeries() {
  const { downloadByInterface, uploadByInterface } = getAlignedSpeedData();
  const visibleNames = getSpeedInterfaceNames().filter(isInterfaceVisible);
  const slotCount = chartData.value.times.length;
  const combined: number[] = [];

  for (let index = 0; index < slotCount; index++) {
    let total = 0;
    visibleNames.forEach((name) => {
      total += downloadByInterface[name]?.[index] ?? 0;
      total += uploadByInterface[name]?.[index] ?? 0;
    });
    combined.push(total);
  }

  return [
    {
      name: "__usage__",
      type: "line",
      yAxisIndex: 1,
      data: toStackedAreaData(combined),
      smooth: 0.35,
      showSymbol: false,
      connectNulls: true,
      lineStyle: {
        width: 0,
        opacity: 0,
      },
      areaStyle: {
        color: SPEED_CHART_COLORS[0],
        opacity: SPEED_BACKGROUND_OPACITY,
      },
      emphasis: {
        disabled: true,
      },
      silent: true,
      z: 1,
    },
  ];
}

function buildSpeedSeries() {
  if (!props.showNetworkSpeed) {
    return [];
  }

  if (props.chartVariant === "lines") {
    return buildSpeedBackgroundSeries();
  }

  const { downloadByInterface } = getAlignedSpeedData();
  const visibleNames = getSpeedInterfaceNames().filter(isInterfaceVisible);

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
      smooth: 0.35,
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
  const pingBounds =
    props.chartVariant === "lines"
      ? getChartPingBounds()
      : { min: CHART_Y_MIN, max: getChartYMax() };

  const latencyAxis = {
    type: "value" as const,
    min: pingBounds.min,
    max: pingBounds.max,
    inverse: props.showNetworkSpeed && props.chartVariant === "bars",
    axisLabel: {
      fontSize: 9,
      color: "#666",
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
        color: "#888",
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
  const hasTimeouts = chartData.value.timeoutBars.some((failures, index) => {
    const visibleFailures = failures.filter((failure) =>
      isInterfaceVisible(failure.interfaceName)
    );
    if (visibleFailures.length > 0) {
      return true;
    }
    const best = bestSeries[index];
    return best !== null && best !== undefined && isPingTimeout(best);
  });

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
  const failures = (chartData.value.timeoutBars[axisIndex] ?? []).filter(
    (failure) => isInterfaceVisible(failure.interfaceName)
  );
  if (failures.length > 0) {
    return true;
  }

  return best !== null && best !== undefined && isPingTimeout(best);
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
    data: (interfaceBands[name] ?? []).map((delta) => {
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
      chartColorAt(PING_CHART_COLORS, index);
    const data = chartData.value.times.map((_, slotIndex) => {
      const value = chartData.value.seriesData[name]?.[slotIndex];
      if (value === null || value === undefined) {
        return null;
      }
      if (isInterfaceSlotTimeout(slotIndex, name, value)) {
        return null;
      }
      return value;
    });

    return {
      name,
      type: "line",
      yAxisIndex: 0,
      data,
      smooth: 0.3,
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
      emphasis: {
        focus: "series",
        lineStyle: {
          width: ROUTE_LINE_WIDTH + 0.5,
        },
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

function truncateInterfaceName(name: string, maxLength = 14) {
  if (name.length <= maxLength) {
    return name;
  }
  return `${name.slice(0, maxLength - 1)}…`;
}

function tooltipRow(label: string, value: string, options?: { muted?: boolean }) {
  const labelStyle = options?.muted
    ? "color:#888;font-size:11px"
    : "color:#bbb;font-size:11px";
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
  const label = `<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:5px;height:5px;border-radius:50%;background:${color};flex-shrink:0"></span>${truncateInterfaceName(name)}</span>`;
  return tooltipRow(label, valueHtml, options);
}

function tooltipSection(title: string) {
  return `<div style="padding:6px 0 3px;color:#666;font-size:10px;text-transform:uppercase;letter-spacing:0.04em">${title}</div>`;
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
  const sections: string[] = [];
  const visible = getVisibleInterfaces();

  const latencyRows: string[] = [];
  visible.forEach((interfaceName) => {
    const value = chartData.value.seriesData[interfaceName]?.[axisIndex];
    const color = getPingInterfaceColor(interfaceName);

    if (value !== null && value !== undefined && !isPingTimeout(value, true)) {
      latencyRows.push(
        tooltipInterfaceRow(color, interfaceName, formatLatencyValue(value))
      );
      return;
    }

    const timedOut = (chartData.value.timeoutBars[axisIndex] ?? []).some(
      (failure) =>
        failure.interfaceName === interfaceName &&
        isInterfaceVisible(failure.interfaceName)
    );
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
    const visibleNames = getSpeedInterfaceNames().filter(isInterfaceVisible);
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
    return t("$vuetify.networkLatency.noData");
  }

  return `<div style="line-height:1.35;font-size:12px;min-width:180px;max-width:280px">${sections.join("")}</div>`;
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
      left: 8,
      right: 8,
      bottom: 8,
      top: 8,
      containLabel: true,
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
      backgroundColor: "rgba(18, 18, 18, 0.92)",
      borderColor: "rgba(255, 255, 255, 0.08)",
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: "#fff", fontSize: 12 },
      extraCssText:
        "border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.35);",
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

function ensureChartInstance() {
  if (!chartRef.value || chartInstance) {
    return;
  }

  chartInstance = echarts.init(chartRef.value, null, {
    useDirtyRect: false,
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
  if (!chartRef.value || !props.active || allPings.value.length === 0) {
    return;
  }

  ensureChartInstance();
  if (!chartInstance) {
    return;
  }

  const isHovering =
    pointerInsideChart &&
    hoverDataIndex !== null &&
    chartData.value.times.length > 0;

  if (isHovering) {
    chartInstance.setOption(buildChartDataOption(), {
      notMerge: false,
      replaceMerge: ["series"],
    });
    chartInstance.resize();
    return;
  }

  chartInstance.setOption(buildChartOption(), {
    notMerge: false,
    replaceMerge: ["series"],
  });
  chartInstance.resize();
}

const initChart = async () => {
  if (!chartRef.value || !props.active) return;

  await nextTick();

  if (allPings.value.length === 0) {
    disposeChart();
    return;
  }

  if (!chartInstance) {
    ensureChartInstance();
  }

  renderChart();
};

const disposeChart = () => {
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
      if (allPings.value.length > 0) {
        initChart();
      } else {
        disposeChart();
      }
    }, 100);
  });
};

watch(
  () => props.latency?.interfaces,
  () => {
    if (props.active && allPings.value.length > 0) {
      renderChart();
    }
  },
  { deep: true }
);

watch(
  () => Object.keys(props.latency?.interfaces || {}).length,
  () => {
    hiddenInterfaces.value = new Set();
    if (props.active && allPings.value.length > 0) {
      renderChart();
    }
  }
);

watch(
  () => chartTimeRange.value,
  () => {
    if (props.active && allPings.value.length > 0) {
      renderChart();
    }
  }
);

watch(
  () => props.networkSpeedHistory,
  () => {
    if (props.active && allPings.value.length > 0) {
      renderChart();
    }
  },
  { deep: true }
);

watch(
  () => props.active,
  (active) => {
    if (active) {
      refreshChart();
    } else {
      disposeChart();
    }
  }
);

onMounted(() => {
  if (props.active) {
    refreshChart();
  }
});

onUnmounted(() => {
  disposeChart();
});
</script>

<template>
  <div>
    <div v-if="!hideHeader" class="d-flex align-center justify-space-between mb-3">
      <span class="text-subtitle-1 font-weight-medium">
        {{ t("$vuetify.connections.latency") }}
      </span>

      <v-btn-toggle
        v-if="!compact && allPings.length > 0"
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

    <div class="d-flex flex-wrap gap-3 mb-3">
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
    </div>

    <div v-if="allPings.length > 0">
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
          >{{ item.name }}</span>
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
</style>
