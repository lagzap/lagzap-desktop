<script setup lang="ts">
import { useProfileChart } from "~/composables/useProfileChart";
import { formatMs } from "~/utils/localeFormat";

/** The ping the game's own traffic gets now (the newest point of the
 * profile's actual ping line), for a title that is playing. Once measured
 * it stays (a timeout or a chart reload keeps the last ping); the fallback
 * shows only before the first one. */
const props = defineProps<{ profileId: string; fallback: string }>();
const emit = defineEmits<{ ping: [ms: number | null] }>();

const { chart } = useProfileChart(props.profileId);

const latest = computed<number | null>(() => {
  const points = chart.value?.latency?.actual?.points ?? [];
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i] > 0) return points[i];
  }
  return null;
});
const ping = ref<number | null>(null);
watch(
  latest,
  (ms) => {
    if (ms) ping.value = ms;
  },
  { immediate: true },
);

watch(ping, (ms) => emit("ping", ms), { immediate: true });
onUnmounted(() => emit("ping", null));
</script>

<template>
  <span class="lz-num">{{ ping ? formatMs(ping) : fallback }}</span>
</template>
