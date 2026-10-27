<script setup lang="ts">
import LiveChart from "~/components/network/LiveChart.vue";
import { useOverviewChart, type OverviewRange } from "~/composables/useOverviewChart";
import type { LiveLatencyChart } from "~/types/liveChart";

withDefaults(defineProps<{ chartHeight?: number; compact?: boolean }>(), { chartHeight: 200, compact: false });

const { chart, range, setRange, colorOf } = useOverviewChart();

const latency = computed<LiveLatencyChart | null>(() => {
  const c = chart.value?.latency;
  if (!c) return null;
  return { ...c, series: (c.series ?? []).map((s) => ({ id: s.name, label: s.name, points: s.points })) };
});
</script>

<template>
  <LiveChart
    :latency="latency"
    :traffic="chart?.traffic"
    :range="range"
    :latency-color="colorOf"
    :traffic-color="colorOf"
    :chart-height="chartHeight"
    :compact="compact"
    @update:range="(r) => setRange(r as OverviewRange)"
  />
</template>
