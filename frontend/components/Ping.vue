<script lang="ts" setup>
defineProps<{
  tag?: string;
  latency: number | null;
}>();
</script>

<template>
  <component
    :is="tag ?? 'span'"
    :class="
      latency === null
        ? 'text-grey'
        : latency < 100
        ? 'text-green'
        : latency < 150
        ? 'text-amber'
        : latency < 200
        ? 'text-orange'
        : 'text-red'
    "
  >
    {{ latency === null ? "timeout" : `${latency}ms` }}
  </component>
</template>
