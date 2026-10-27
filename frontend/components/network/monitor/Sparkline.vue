<script setup lang="ts">
import { PING_TIMEOUT_COLOR } from "~/composables/useLatencyMetrics";

/** Lightweight SVG sparkline for Go-computed buckets. Values: >0 sample,
 * 0 = lost (latency only, drawn as a red tick), -1 = no data (gap). */
interface Series {
  points: number[];
  color: string;
  fill?: boolean;
}

const props = withDefaults(
  defineProps<{ series: Series[]; yMax: number; height?: number; markLost?: boolean }>(),
  { height: 44, markLost: false }
);

const H = 40;
const id = `spark-${Math.random().toString(36).slice(2, 9)}`;

const paths = computed(() =>
  props.series.map((s, si) => {
    const n = s.points.length;
    const max = props.yMax > 0 ? props.yMax : 1;
    let line = "";
    let area = "";
    let segStart = -1;
    let lastX = 0;
    const lost: number[] = [];
    for (let i = 0; i < n; i++) {
      const v = s.points[i];
      const x = n > 1 ? (i / (n - 1)) * 100 : 50;
      if (v == null || v < 0 || (props.markLost && v === 0)) {
        if (props.markLost && v === 0) lost.push(x);
        if (segStart >= 0) {
          area += `L${lastX.toFixed(2)},${H}L${segStart.toFixed(2)},${H}Z`;
          segStart = -1;
        }
        continue;
      }
      const y = H - (Math.min(v, max) / max) * (H - 2) - 1;
      if (segStart < 0) {
        segStart = x;
        line += `M${x.toFixed(2)},${y.toFixed(2)}`;
        area += `M${x.toFixed(2)},${H}L${x.toFixed(2)},${y.toFixed(2)}`;
      } else {
        line += `L${x.toFixed(2)},${y.toFixed(2)}`;
        area += `L${x.toFixed(2)},${y.toFixed(2)}`;
      }
      lastX = x;
    }
    if (segStart >= 0) area += `L${lastX.toFixed(2)},${H}L${segStart.toFixed(2)},${H}Z`;
    return { line, area, color: s.color, fill: !!s.fill, lost, grad: `${id}-${si}` };
  })
);
</script>

<template>
  <svg
    class="sparkline"
    :viewBox="`0 0 100 ${H}`"
    preserveAspectRatio="none"
    :style="{ height: `${height}px` }"
    aria-hidden="true"
  >
    <defs>
      <linearGradient v-for="p in paths" :id="p.grad" :key="p.grad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="p.color" stop-opacity="0.35" />
        <stop offset="100%" :stop-color="p.color" stop-opacity="0" />
      </linearGradient>
    </defs>
    <template v-for="p in paths" :key="p.grad + '-g'">
      <path v-if="p.fill && p.area" :d="p.area" :fill="`url(#${p.grad})`" stroke="none" />
      <path
        v-if="p.line"
        :d="p.line"
        fill="none"
        :stroke="p.color"
        stroke-width="1.6"
        stroke-linejoin="round"
        stroke-linecap="round"
        vector-effect="non-scaling-stroke"
      />
      <line
        v-for="x in p.lost"
        :key="`${p.grad}-l-${x}`"
        :x1="x"
        :x2="x"
        :y1="H - 5"
        :y2="H"
        :stroke="PING_TIMEOUT_COLOR"
        stroke-width="1.6"
        vector-effect="non-scaling-stroke"
      />
    </template>
  </svg>
</template>

<style scoped>
.sparkline {
  display: block;
  width: 100%;
  overflow: visible;
}
</style>
