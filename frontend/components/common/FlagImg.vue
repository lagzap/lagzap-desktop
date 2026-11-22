<script setup lang="ts">
import { flagImageTrimmed } from "~/utils/flagImage";

/* A country's flag as a plain image: centred, edge to edge, slightly
 * rounded, at the given height (the width follows the flag). */
const props = withDefaults(defineProps<{ country: string; height?: number }>(), { height: 14 });

const src = ref("");
watch(
  () => props.country,
  async (country) => {
    src.value = await flagImageTrimmed(country);
  },
  { immediate: true },
);
</script>

<template>
  <img
    v-if="src"
    :src="src"
    alt=""
    class="flag-img"
    :style="{ height: `${height}px` }"
  />
  <span v-else class="flag-img flag-img--empty" :style="{ height: `${height}px`, width: `${Math.round(height * 1.4)}px` }" />
</template>

<style scoped>
.flag-img {
  display: inline-block;
  flex-shrink: 0;
  width: auto;
  border-radius: 2px;
  vertical-align: middle;
  object-fit: cover;
}

.flag-img--empty {
  background: rgba(var(--v-theme-on-surface), 0.08);
}
</style>
