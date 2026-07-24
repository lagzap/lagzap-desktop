<script setup lang="ts">
import LatencyPanel from "~/components/network/LatencyPanel.vue";
import { useRouteLatencyMetrics } from "~/composables/useRouteLatencyMetrics";

const props = defineProps<{
  profileId: string;
}>();

const { latency, hasLatencyData, profileSpeedHistory } =
  useRouteLatencyMetrics(props.profileId);
</script>

<template>
  <LatencyPanel
    v-if="hasLatencyData"
    :latency="latency"
    :chart-height="240"
    :network-speed-history="profileSpeedHistory"
    chart-variant="lines"
    rolling-samples
    :probe-samples-per-second="2"
    show-network-speed
    show-legend
    dense-time-range
    show-summary-metrics
    show-protection-insight
  />
</template>
