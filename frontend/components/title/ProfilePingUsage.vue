<script setup lang="ts">
import { useLocale } from "vuetify";
import LiveChart from "~/components/network/LiveChart.vue";
import { useProfileChart } from "~/composables/useProfileChart";
import type { OverviewRange } from "~/composables/useOverviewChart";

const props = defineProps<{
  profileId: string;
  /** Traffic only (usage popup for profiles without a card chart). */
  trafficOnly?: boolean;
}>();

const { chart, view, latency, traffic, range, setRange, latencyColor, trafficColor } = useProfileChart(props.profileId);

const { t } = useLocale();
const hasData = computed(() =>
  props.trafficOnly ? !!traffic.value?.series?.length : !!latency.value?.series?.length || !!traffic.value?.series?.length
);
</script>

<template>
  <LiveChart
    v-if="hasData"
    :id="trafficOnly ? undefined : `profile-chart-${profileId}`"
    v-model:view="view"
    :fixed-view="trafficOnly ? 'traffic' : undefined"
    :latency="latency"
    :traffic="traffic"
    :range="range"
    :latency-color="latencyColor"
    :traffic-color="trafficColor"
    :chart-height="240"
    :session-start="chart?.session_start ?? 0"
    @update:range="(r) => setRange(r as OverviewRange)"
  />
  <div v-else-if="trafficOnly" class="text-center text-medium-emphasis py-8 text-body-2">
    {{ t("$vuetify.title.profile.noTrafficYet") }}
  </div>
</template>
