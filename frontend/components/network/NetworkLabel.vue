<script setup lang="ts">
import { useNetworkColor } from "~/composables/useNetworkColor";

/** A connection's transport as colored text, in the latency chart's colors. */
const props = defineProps<{ network?: string }>();
const networkColor = useNetworkColor();
</script>

<template>
  <span class="network-label" :style="{ color: networkColor(props.network) }">
    {{ props.network?.toUpperCase() }}
  </span>
</template>

<style scoped>
.network-label {
  font-size: 0.625rem;
  font-weight: 400;
}
</style>
