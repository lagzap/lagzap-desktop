<script setup lang="ts">
/** An app's last minute of download speed as a small filled line. */
const props = defineProps<{ points: number[]; color?: string }>();

const WIDTH = 120;
const HEIGHT = 28;
// A floor so a trickle does not fill the chart.
const MIN_SCALE = 64 * 1024;

const paths = computed(() => {
  const points = props.points;
  if (points.length < 2) return { line: "", area: "" };
  const max = Math.max(MIN_SCALE, ...points);
  const step = WIDTH / (points.length - 1);
  const coords = points.map((value, i) => {
    const x = i * step;
    const y = HEIGHT - 1 - (Math.max(0, value) / max) * (HEIGHT - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M${coords.join(" L")}`;
  return { line, area: `${line} L${WIDTH},${HEIGHT} L0,${HEIGHT} Z` };
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
    <path
      :d="paths.area"
      :fill="color ?? 'rgb(var(--v-theme-primary))'"
      fill-opacity="0.15" />
    <path
      :d="paths.line"
      fill="none"
      :stroke="color ?? 'rgb(var(--v-theme-primary))'"
      stroke-width="1.5"
      stroke-linejoin="round"
      vector-effect="non-scaling-stroke"
    />
  </svg>
</template>

<style scoped>
.app-sparkline {
  display: block;
  flex: none;
}

/* Time runs left to right in Persian too. */
:global(.v-locale--is-rtl) .app-sparkline {
  direction: ltr;
}
</style>
