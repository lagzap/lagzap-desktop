<script lang="ts" setup>
import { min } from 'es-toolkit/compat';
import type { NodeEchoResult } from '~/bindings/github.com/lagzap/lagzap/adapter';


const props = defineProps<{
  tag?: string;
}>();

const store = useStore();

const echo = computed<NodeEchoResult | null>(() => store.echo ? store.echo[props.tag] : null);

// Helper function to get color class based on gaming score
function getScoreColorClass(score: number | null): string {
  if (score === null || score < 0) {
    return 'text-grey'; // Failed connection or no data
  }

  if (score >= 80) {
    return 'text-green'; // Excellent for gaming
  } else if (score >= 70) {
    return 'text-lime'; // Good for gaming
  } else if (score >= 60) {
    return 'text-amber'; // Playable but not ideal
  } else {
    return 'text-red'; // Poor gaming experience
  }
}

// Helper function to get score description
function getScoreDescription(score: number | null): string {
  if (score === null || score < 0) {
    return 'Failed';
  }

  if (score >= 80) {
    return 'Excellent';
  } else if (score >= 70) {
    return 'Good';
  } else if (score >= 60) {
    return 'Fair';
  } else {
    return 'Poor';
  }
}

// Helper function to get score description
function getScoreIcon(score: number | null): string {
  if (score === null || score < 0) {
    return 'mdi-signal-off';
  }
  
  if (score >= 80) {
    return 'mdi-signal-cellular-3';
  } else if (score >= 70) {
    return 'mdi-signal-cellular-2';
  } else if (score >= 60) {
    return 'mdi-signal-cellular-1';
  } else {
    return 'mdi-signal-cellular-outline';
  }
}
</script>

<template>
  <span :class="getScoreColorClass(echo?.score || null)" class="d-flex align-center gap-1">
    <span class="me-1">{{ echo && echo.min_latency ? `${echo.min_latency}ms` : "timeout" }}</span>
    <v-icon :icon="getScoreIcon(echo?.score || null)" size="small" />
  </span>
</template>
