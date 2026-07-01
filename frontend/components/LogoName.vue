<script lang="ts" setup>
const store = useStore();
const isLagZap = computed(() => store.isLagZap);
</script>

<template>
  <span v-if="isLagZap" class="lagzap-name">
    Lag<span class="text-primary">Z</span>ap
  </span>
  <span v-else class="cyrex-name">
    Cyrex
  </span>
</template>
