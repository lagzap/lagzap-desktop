<script setup lang="ts">
import LatencyPanel from "~/components/network/LatencyPanel.vue";
import { useRouteLatencyMetrics } from "~/composables/useRouteLatencyMetrics";
import { useLocale } from "vuetify";

const props = defineProps<{
  profileId: string;
}>();

const store = useStore();
const { t } = useLocale();
const { latency, profileSpeedHistory } = useRouteLatencyMetrics(props.profileId);
</script>

<template>
  <div v-if="store.connected">
    <LatencyPanel
      :latency="latency"
      :chart-height="240"
      :network-speed-history="profileSpeedHistory"
      chart-variant="lines"
      show-network-speed
      show-legend
      dense-time-range
    />
  </div>
  <div v-else-if="store.appReady" class="text-center text-medium-emphasis py-6">
    <div class="text-body-2">
      {{ t("$vuetify.status.latencyUnavailableOffline") }}
    </div>
  </div>
  <div v-else class="text-center text-medium-emphasis py-6">
    <div class="text-body-2">
      {{ t("$vuetify.status.connectionFailed") }}
    </div>
  </div>
</template>
