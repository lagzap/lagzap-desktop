<script lang="ts" setup>
import type { RelayRoute } from "~/bindings/github.com/lagzap/zap/data";
import {
  displayPingMsForRelay,
  displayScoreForRelay,
} from "~/composables/relayPingDisplay";
import {
  getLatencyColorClass,
  getScoreColorClass,
} from "~/composables/useLatencyMetrics";

const props = defineProps<{
  tag?: string;
  latencyMs?: number | null;
}>();

const store = useStore();
const { routeProbeHistory } = useMonitoringStore();

function toTextColor(className: string) {
  if (className === "grey") {
    return "text-grey";
  }
  return `text-${className}`;
}

const relayRoute = computed<RelayRoute | null>(() => {
  if (!props.tag || !store.routes) {
    return null;
  }

  if (store.routes[props.tag]) {
    return store.routes[props.tag];
  }

  return (
    store.routes[`${props.tag}-ipv4-udp`] ||
    store.routes[`${props.tag}-ipv4-tcp`] ||
    store.routes[`${props.tag}-ipv6-udp`] ||
    store.routes[`${props.tag}-ipv6-tcp`] ||
    null
  );
});

const displayLatencyMs = computed(() => {
  if (props.latencyMs != null && props.latencyMs > 0) {
    return Math.round(props.latencyMs);
  }
  return displayPingMsForRelay(
    props.tag,
    relayRoute.value,
    routeProbeHistory.value
  );
});

const displayScore = computed(() => displayScoreForRelay(relayRoute.value));

const colorClass = computed(() => {
  if (displayLatencyMs.value == null) {
    return "text-grey";
  }
  if (displayScore.value != null && displayScore.value > 0) {
    return toTextColor(getScoreColorClass(displayScore.value));
  }
  return toTextColor(getLatencyColorClass(displayLatencyMs.value));
});
</script>

<template>
  <span :class="['text-caption', 'font-weight-medium', colorClass]">
    {{ displayLatencyMs != null ? `${displayLatencyMs}ms` : "-" }}
  </span>
</template>
