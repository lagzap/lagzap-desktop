<script setup lang="ts">
/** An app's last minute of download speed: one small filled line per
 * series (each internet it uses, or its total), all on one scale. */
export interface SparkSeries {
  points: number[];
  color?: string;
}
const props = defineProps<{ series: SparkSeries[] }>();

const WIDTH = 120;
const HEIGHT = 28;
// A floor so a trickle does not fill the chart.
const MIN_SCALE = 64 * 1024;
const PRIMARY = "rgb(var(--v-theme-primary))";

const paths = computed(() => {
  const drawn = props.series.filter((s) => s.points.length >= 2);
  const max = Math.max(MIN_SCALE, ...drawn.flatMap((s) => s.points));
  return drawn.map((s) => {
    const step = WIDTH / (s.points.length - 1);
    const coords = s.points.map((value, i) => {
      const x = i * step;
      const y = HEIGHT - 1 - (Math.max(0, value) / max) * (HEIGHT - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = `M${coords.join(" L")}`;
    return { line, area: `${line} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z`, color: s.color ?? PRIMARY };
  });
});
</script>

<template>
  <svg
    class="app-sparkline"
    :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
    :width="WIDTH"
    :height="HEIGHT"
    preserveAspectRatio="none"
    aria-hidden="true"
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
  </svg>
</template>

<style scoped>
/* Time runs left to right in Persian too. (A scoped :global(...) rule here
   compiled to a bare .v-locale--is-rtl and turned the whole app LTR.) */
.app-sparkline {
  display: block;
  flex: none;
  direction: ltr;
}
</style>
