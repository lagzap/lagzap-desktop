<script lang="ts" setup>
defineProps<{
  latency: number | null;
}>();
</script>

<template>
  <v-icon
    :icon="
      latency === null
        ? 'mdi-signal-off'
        : latency < 100
        ? 'mdi-signal-cellular-3'
        : latency < 150
        ? 'mdi-signal-cellular-2'
        : latency < 200
        ? 'mdi-signal-cellular-1'
        : 'mdi-signal-off'
    "
    :color="
      latency === null
        ? 'grey'
        : latency < 100
        ? 'green'
        : latency < 150
        ? 'yellow'
        : latency < 200
        ? 'orange'
        : 'red'
    "
  />
</template>
