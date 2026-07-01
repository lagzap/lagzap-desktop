<script lang="ts" setup>
const store = useStore();
const isLagZap = computed(() => store.isLagZap);
</script>

<template>
  <LagzapLogo v-if="isLagZap" />
  <CyrexLogo v-else />
</template>
