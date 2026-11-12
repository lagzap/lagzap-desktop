<script setup lang="ts">
import { qualityColor, useNetworkMonitor } from "~/composables/useNetworkMonitor";
import { localDigits, msUnit } from "~/utils/localeFormat";

// An adapter's internet ping, from the same Go stream as the Multi Internet
// page. Mount it only while it is on screen: mounting starts the stream.
const props = defineProps<{ name: string }>();
const { monitor } = useNetworkMonitor();
const ping = computed(() => monitor.value?.interfaces?.find((iface) => iface.name === props.name)?.ping);
</script>

<template>
  <span
    class="text-caption font-weight-medium"
    :class="ping && ping.now > 0 ? `text-${qualityColor(ping.quality)}` : 'text-medium-emphasis'"
  >
    {{ ping && ping.now > 0 ? `${localDigits(ping.now)}${msUnit()}` : "—" }}
  </span>
</template>
