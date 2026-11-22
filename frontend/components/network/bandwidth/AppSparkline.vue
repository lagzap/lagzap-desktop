<script setup lang="ts">
import { useTheme } from "vuetify";
import { chartLineColor } from "~/composables/useLatencyMetrics";

/** A last minute of download speed: one small filled line per series
 * (each internet, or a total), all on one scale. fill: stretch to the
 * parent's width (the internet cards). */
export interface SparkSeries {
  points: number[];
  color?: string;
}
/** max: a ceiling shared with other charts, so they compare at a glance.
 * cursorAgo: a cursor line this many points before the newest (charts that
 * end at the same moment share it); hover reports it under the pointer. */
const props = withDefaults(
  defineProps<{
    series: SparkSeries[];
    width?: number;
    height?: number;
    fill?: boolean;
    max?: number;
    cursorAgo?: number | null;
  }>(),
  {
    width: 120,
    height: 28,
    fill: false,
    cursorAgo: null,
  },
);
const emit = defineEmits<{ hover: [number | null] }>();

const count = computed(() => Math.max(0, ...props.series.map((s) => s.points.length)));
function onMove(event: MouseEvent) {
  const rect = (event.currentTarget as SVGElement).getBoundingClientRect();
  if (!rect.width || count.value < 2) return;
  const i = Math.round(((event.clientX - rect.left) / rect.width) * (count.value - 1));
  emit("hover", count.value - 1 - Math.min(count.value - 1, Math.max(0, i)));
}
/** The cursor line's x in the view box, null when hidden. */
const cursorX = computed(() => {
  const ago = props.cursorAgo;
  if (ago == null || count.value < 2 || ago < 0 || ago > count.value - 1) return null;
  return ((count.value - 1 - ago) / (count.value - 1)) * WIDTH.value;
});

const WIDTH = computed(() => props.width);
const HEIGHT = computed(() => props.height);
// A floor so a trickle does not fill the chart.
const MIN_SCALE = 64 * 1024;
const theme = useTheme();
const LINE = computed(() => chartLineColor(theme.current.value.dark));

const paths = computed(() => {
  const drawn = props.series.filter((s) => s.points.length >= 2);
  const max = Math.max(MIN_SCALE, props.max ?? 0, ...drawn.flatMap((s) => s.points));
  const width = WIDTH.value;
  const height = HEIGHT.value;
  return drawn.map((s) => {
    const step = width / (s.points.length - 1);
    const coords = s.points.map((value, i) => {
      const x = i * step;
      const y = height - 1 - (Math.max(0, value) / max) * (height - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = `M${coords.join(" L")}`;
    return { line, area: `${line} L${width},${height} L0,${height} Z`, color: s.color ?? LINE.value };
  });
});
</script>

<template>
  <svg
    class="app-sparkline"
    :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
    :width="fill ? '100%' : WIDTH"
    :height="HEIGHT"
    preserveAspectRatio="none"
    aria-hidden="true"
    @mousemove="onMove"
    @mouseleave="emit('hover', null)"
  >
    <template
      v-for="(p, i) in paths"
      :key="i">
      <path
        :d="p.area"
        :fill="p.color"
        fill-opacity="0.12" />
      <path
        :d="p.line"
        fill="none"
        :stroke="p.color"
        stroke-width="1.5"
        stroke-linejoin="round"
        vector-effect="non-scaling-stroke"
      />
    </template>
    <line
      v-if="cursorX != null"
      :x1="cursorX"
      :x2="cursorX"
      y1="0"
      :y2="HEIGHT"
      class="app-sparkline__cursor"
      stroke-width="1"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>

<style scoped>
/* Time runs left to right in Persian too. (A scoped :global(...) rule here
   compiled to a bare .v-locale--is-rtl and turned the whole app LTR.) */
.app-sparkline__cursor {
  stroke: rgba(var(--v-theme-on-surface), 0.45);
}

.app-sparkline {
  display: block;
  flex: none;
  direction: ltr;
}
</style>
