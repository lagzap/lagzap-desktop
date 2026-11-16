<script setup lang="ts">
import { localDigits } from "~/utils/localeFormat";

/** A chart's time range (1m, 5m, 15m, 60m): joined pills, one picked. */
defineProps<{ ranges: readonly string[] }>();
const range = defineModel<string>({ required: true });
</script>

<template>
  <div class="range-tabs" role="radiogroup">
    <button
      v-for="item in ranges"
      :key="item"
      type="button"
      role="radio"
      class="range-tab"
      :class="{ 'range-tab--active': range === item }"
      :aria-checked="range === item"
      @click="range = item"
    >
      {{ localDigits(item) }}
    </button>
  </div>
</template>

<style scoped>
.range-tabs {
  display: inline-flex;
  flex: none;
  border: 2px solid rgba(var(--v-theme-on-surface), 0.22);
  border-radius: 999px;
  padding: 2px;
}

.range-tab {
  cursor: pointer;
  border: none;
  border-radius: 999px;
  background: transparent;
  padding: 2px 10px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  transition: background 120ms ease, color 120ms ease;
}

.range-tab--active {
  background: rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-weight: 600;
}
</style>
