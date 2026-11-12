<script setup lang="ts">
import { useLocale } from "vuetify";
import LiveChart from "~/components/network/LiveChart.vue";
import QuickRating from "~/components/title/QuickRating.vue";
import { useProfileChart } from "~/composables/useProfileChart";
import type { OverviewRange } from "~/composables/useOverviewChart";
import { ProfileFlag } from "~/constants/profile";

const props = defineProps<{
  profileId: string;
  /** The usage popup, for profiles without a card chart: no rating, and a
   * message while nothing has been measured yet. */
  popup?: boolean;
  /** A divider above the chart, shown and animated with it. */
  divided?: boolean;
}>();

const { chart, view, latency, traffic, range, setRange, latencyColor, trafficColor } = useProfileChart(props.profileId);

const { t } = useLocale();
const store = useStore();
// Only game profiles (multi-path or game packets) chart latency; downloads,
// chat and the like show their traffic alone.
const isGame = computed(() => {
  const flags = store.profiles.find((p) => p.id === props.profileId)?.flags ?? 0;
  return (flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET)) !== 0;
});
const hasData = computed(() => !!latency.value?.series?.length || !!traffic.value?.series?.length);
</script>

<template>
  <!-- The chart is a session's own: it grows in when one starts, and nothing
       shows while only the route preview is there. -->
  <Transition name="chart-grow">
    <div v-if="hasData" class="ping-usage">
      <LiveChart
        :id="popup ? undefined : `profile-chart-${profileId}`"
        v-model:view="view"
        :fixed-view="isGame ? undefined : 'traffic'"
        range-tabs
        :latency="latency"
        :traffic="traffic"
        :range="range"
        :latency-color="latencyColor"
        :traffic-color="trafficColor"
        :chart-height="240"
        :session-start="chart?.session_start ?? 0"
        :session-divider="divided"
        @update:range="(r) => setRange(r as OverviewRange)"
      />
      <QuickRating v-if="!popup" :profile-id="profileId" />
    </div>
    <div v-else-if="popup" class="text-center text-medium-emphasis py-8 text-body-2">
      {{ t("$vuetify.title.profile.noTrafficYet") }}
    </div>
  </Transition>
</template>

<style scoped>
.ping-usage {
  position: relative;
}

.chart-grow-enter-active,
.chart-grow-leave-active {
  overflow: hidden;
  transition:
    max-height 0.45s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.35s ease;
}

.chart-grow-enter-from,
.chart-grow-leave-to {
  max-height: 0;
  opacity: 0;
}

.chart-grow-enter-to,
.chart-grow-leave-from {
  max-height: 640px;
  opacity: 1;
}
</style>
