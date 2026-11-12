<script setup lang="ts">
import { useNetworkColor } from "~/composables/useNetworkColor";

/** A connection's transport as colored text, in the latency chart's colors.
 * `protocol`: the sniffed protocol (TLS, HTTP, QUIC, ...) shown instead of
 * the transport; the color still tells TCP from UDP. */
const props = defineProps<{ network?: string; protocol?: string }>();
const networkColor = useNetworkColor();
</script>

<template>
  <span class="network-label" :style="{ color: networkColor(props.network) }">
    {{ (props.protocol || props.network)?.toUpperCase() }}
  </span>
</template>

<style scoped>
.network-label {
  font-size: 0.625rem;
  font-weight: 400;
}
</style>
