<script setup lang="ts" generic="T extends string">
/** Joined round pills to pick one value, the style of the charts' 1m … 60m
 * range switch. color tints the chosen pill (a theme color). */
defineProps<{
  items: { value: T; title: string; icon?: string; onClick?: () => void }[];
  disabled?: boolean;
  color?: string;
}>();
const value = defineModel<T>({ required: true });

function pick(item: { value: T; onClick?: () => void }) {
  if (value.value === item.value) item.onClick?.();
  else value.value = item.value;
}
</script>

<template>
  <div
    class="pill-toggle"
    :class="{ 'pill-toggle--disabled': disabled }"
    role="radiogroup">
    <button
      v-for="item in items"
      :key="item.value"
      type="button"
      role="radio"
      class="pill-toggle__pill"
      :class="{ 'pill-toggle__pill--active': value === item.value }"
      :style="value === item.value && color ? { background: `rgba(var(--v-theme-${color}), 0.18)`, color: `rgb(var(--v-theme-${color}))` } : undefined"
      :aria-checked="value === item.value"
      :disabled="disabled"
      @click="pick(item)"
    >
      <v-icon
        v-if="item.icon"
        :icon="item.icon"
        size="14" />
      {{ item.title }}
    </button>
  </div>
</template>

<style scoped>
.pill-toggle {
  display: inline-flex;
  flex-wrap: wrap;
  border: 2px solid rgba(var(--v-theme-on-surface), 0.22);
  border-radius: 999px;
  padding: 2px;
}

.pill-toggle--disabled {
  opacity: 0.5;
}

.pill-toggle__pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  border: none;
  border-radius: 999px;
  background: transparent;
  padding: 2px 10px;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.75rem;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transition: background 120ms ease, color 120ms ease;
}

.pill-toggle__pill:disabled {
  cursor: default;
}

.pill-toggle__pill--active {
  background: rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.92);
  font-weight: 600;
}
</style>
