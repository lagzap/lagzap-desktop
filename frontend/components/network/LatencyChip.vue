<script lang="ts" setup>
import { ref, toRef } from "vue";
import LatencyPanel from "~/components/network/LatencyPanel.vue";
import {
  getScoreColorClass,
  useLatencyMetrics,
  type MultiInterfaceLatency,
} from "~/composables/useLatencyMetrics";

const props = defineProps<{
  latency?: MultiInterfaceLatency | null;
}>();

const menuVisible = ref(false);
const { lastPingDisplay, combinedScore } = useLatencyMetrics(toRef(props, "latency"));
</script>

<template>
  <div>
    <v-menu v-model:model-value="menuVisible" location="bottom center">
      <template #activator="{ props: menuProps }">
        <v-chip
          v-bind="menuProps"
          size="small"
          rounded="full"
          variant="text"
          :color="getScoreColorClass(combinedScore)"
          class="cursor-pointer"
        >
          {{ lastPingDisplay }}
        </v-chip>
      </template>

      <v-card min-width="380" max-width="420">
        <v-card-text v-if="menuVisible">
          <LatencyPanel :latency="latency" :active="menuVisible" compact />
        </v-card-text>
      </v-card>
    </v-menu>
  </div>
</template>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}
</style>
