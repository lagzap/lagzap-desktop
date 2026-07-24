<script setup lang="ts">
import * as echarts from "echarts";
import { useLocale } from "vuetify";
import { useHumanSpeed } from "~/composables/helper";
import type { ProfileSpeedSample } from "~/composables/useProfileConnectionStats";

const props = defineProps<{
  history: ProfileSpeedSample[];
  downloadSpeed: number;
  uploadSpeed: number;
}>();

const { t } = useLocale();
const chartRef = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

function formatAxis(bytesPerSec: number) {
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(0)} MB/s`;
  }
  if (bytesPerSec >= 1024) {
    return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  }
  return `${Math.round(bytesPerSec)} B/s`;
}

function renderChart() {
  if (!chartRef.value) {
    return;
  }
  if (!chart) {
    chart = echarts.init(chartRef.value, null, { renderer: "canvas" });
  }

  const samples = props.history;
  const times = samples.map((sample) => sample.t);
  const downloads = samples.map((sample) => sample.download);
  const uploads = samples.map((sample) => sample.upload);
  const max = Math.max(1, ...downloads, ...uploads);
  const unit = max >= 1024 * 1024 ? 1024 * 1024 : max >= 1024 ? 1024 : 1;
  const yMax = Math.ceil((max * 1.2) / unit) * unit;

  chart.setOption(
    {
      animation: false,
      grid: {
        left: 44,
        right: 10,
        top: 28,
        bottom: 22,
      },
      legend: {
        top: 0,
        right: 0,
        itemWidth: 10,
        itemHeight: 6,
        textStyle: {
          color: "rgba(255,255,255,0.65)",
          fontSize: 10,
        },
        data: [
          t("$vuetify.connections.download"),
          t("$vuetify.connections.upload"),
        ],
      },
      tooltip: {
        trigger: "axis",
        appendToBody: true,
        valueFormatter: (value: number | string) =>
          useHumanSpeed(Number(value) || 0),
      },
      xAxis: {
        type: "category",
        data: times,
        boundaryGap: false,
        axisLabel: { show: false },
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "rgba(255,255,255,0.12)" } },
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: yMax,
        axisLabel: {
          color: "rgba(255,255,255,0.45)",
          fontSize: 9,
          formatter: (value: number) => formatAxis(value),
        },
        splitLine: {
          lineStyle: { color: "rgba(255,255,255,0.06)" },
        },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          name: t("$vuetify.connections.download"),
          type: "line",
          data: downloads,
          smooth: 0.25,
          showSymbol: false,
          lineStyle: { width: 1.6, color: "#34d399" },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(52, 211, 153, 0.35)" },
              { offset: 1, color: "rgba(52, 211, 153, 0.02)" },
            ]),
          },
        },
        {
          name: t("$vuetify.connections.upload"),
          type: "line",
          data: uploads,
          smooth: 0.25,
          showSymbol: false,
          lineStyle: { width: 1.6, color: "#38bdf8" },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(56, 189, 248, 0.28)" },
              { offset: 1, color: "rgba(56, 189, 248, 0.02)" },
            ]),
          },
        },
      ],
    },
    { notMerge: true }
  );
}

function resizeChart() {
  chart?.resize();
}

watch(
  () => props.history,
  () => {
    nextTick(renderChart);
  },
  { deep: true }
);

onMounted(() => {
  nextTick(() => {
    renderChart();
    resizeChart();
  });
  window.addEventListener("resize", resizeChart);
});

onUnmounted(() => {
  window.removeEventListener("resize", resizeChart);
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div class="profile-speed-chart">
    <div class="profile-speed-chart__now text-caption">
      <span class="profile-speed-chart__down"
        >↓ {{ useHumanSpeed(downloadSpeed) }}</span
      >
      <span class="profile-speed-chart__sep">·</span>
      <span class="profile-speed-chart__up"
        >↑ {{ useHumanSpeed(uploadSpeed) }}</span
      >
    </div>
    <div
      v-if="history.length > 1"
      ref="chartRef"
      class="profile-speed-chart__canvas"
    />
    <div
      v-else
      class="profile-speed-chart__empty text-caption"
    >
      {{ t("$vuetify.title.profile.speedChartEmpty") }}
    </div>
  </div>
</template>

<style scoped>
.profile-speed-chart {
  width: 280px;
  padding: 0.55rem 0.65rem 0.45rem;
}

.profile-speed-chart__now {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-bottom: 0.35rem;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.78);
}

.profile-speed-chart__sep {
  opacity: 0.4;
}

.profile-speed-chart__down {
  color: #34d399;
}

.profile-speed-chart__up {
  color: #38bdf8;
}

.profile-speed-chart__canvas {
  width: 100%;
  height: 128px;
}

.profile-speed-chart__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 88px;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
</style>
