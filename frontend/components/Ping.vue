<script lang="ts" setup>
import { min } from "es-toolkit/compat";
import type { RelayRoute } from "~/bindings/github.com/lagzap/zap/data";

const props = defineProps<{
  tag?: string;
}>();

const store = useStore();

const relayRoute = computed<RelayRoute | null>(() =>
  store.routes ? (store.routes[`${props.tag}-ipv4-udp`] || store.routes[`${props.tag}-ipv4-tcp`]) : null
);

// Helper function to get color class based on gaming score
function getScoreColorClass(score: number | null): string {
  if (score === null || score < 0) {
    return "text-grey"; // Failed connection or no data
  }

  if (score >= 80) {
    return "text-green"; // Excellent for gaming
  } else if (score >= 70) {
    return "text-lime"; // Good for gaming
  } else if (score >= 60) {
    return "text-amber"; // Playable but not ideal
  } else {
    return "text-red"; // Poor gaming experience
  }
}

// Helper function to get score description
function getScoreDescription(score: number | null): string {
  if (score === null || score < 0) {
    return "Failed";
  }

  if (score >= 80) {
    return "Excellent";
  } else if (score >= 70) {
    return "Good";
  } else if (score >= 60) {
    return "Fair";
  } else {
    return "Poor";
  }
}
</script>

<template>
  <span
    :class="getScoreColorClass(relayRoute?.routes?.[0]?.score || null)"
    class="d-flex align-center gap-1 text-caption"
  >
    <span class="ms-1">{{
      relayRoute?.routes?.[0].min_latency
        ? `${Math.max(0, relayRoute?.routes?.[0].min_latency)}ms`
        : "timeout"
    }}</span>
  </span>
</template>
