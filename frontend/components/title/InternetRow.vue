<script setup lang="ts">
import { useLocale } from "vuetify";

// One internet inside an InternetCard: picked or not (a checkbox, or a radio
// when only one can be used), its icon and name, what the append slot shows,
// and its share of the traffic as a bar along its bottom when given.
const props = defineProps<{
  name: string;
  icon: string;
  picked: boolean;
  radio?: boolean;
  /** Not connected now (or, with missingText, another problem). */
  missing?: boolean;
  /** What is wrong, instead of "Not connected". */
  missingText?: string;
  disabled?: boolean;
  /** 0..100: its share of new connections. */
  share?: number;
}>();
const emit = defineEmits<{ pick: [] }>();
const { t } = useLocale();

function pick() {
  if (!props.disabled) emit("pick");
}
const color = computed(() => (props.missing ? "warning" : "primary"));
</script>

<template>
  <div
    v-ripple="!disabled"
    :class="['internet-row', { 'internet-row--missing': missing, 'internet-row--disabled': disabled }]"
    role="checkbox"
    :aria-checked="picked"
    :tabindex="disabled ? undefined : 0"
    @click="pick"
    @keydown.enter.prevent="pick"
    @keydown.space.prevent="pick"
  >
    <slot name="prepend" />
    <v-checkbox-btn
      v-if="!radio"
      class="state-only flex-0-0"
      density="compact"
      :color="color"
      :model-value="picked"
      tabindex="-1"
    />
    <v-radio
      v-else
      hide-details
      class="state-only flex-0-0"
      density="compact"
      :color="color"
      :model-value="picked"
      tabindex="-1"
    />
    <v-icon
      size="16"
      :class="{ 'text-medium-emphasis': !picked && !missing, 'text-warning': missing }">
      {{ icon }}
    </v-icon>
    <span
      class="text-caption internet-row__name"
      :class="{ 'text-medium-emphasis': !picked && !missing, 'text-warning': missing }"
    >
      {{ name }}
    </span>
    <span
      v-if="missing"
      class="text-caption text-warning">
      {{ missingText || t("$vuetify.title.profile.server.adapterGone") }}
    </span>
    <slot name="append" />
    <div
      v-if="share !== undefined"
      class="internet-row__share">
      <div
        class="internet-row__share-fill"
        :style="{ width: `${Math.max(0, Math.min(100, share))}%` }" />
    </div>
  </div>
</template>

<style scoped>
.internet-row {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 4px 10px 4px 4px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  cursor: pointer;
  outline: none;
}
.internet-row:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(var(--v-theme-on-surface), 0.3);
}
.internet-row--missing {
  background: rgba(var(--v-theme-warning), 0.1);
}
.internet-row--disabled {
  cursor: default;
  opacity: 0.6;
}
.internet-row__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Its share of the traffic, inside the row along its bottom. */
.internet-row__share {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.internet-row__share-fill {
  height: 100%;
  background: rgb(var(--v-theme-primary));
  transition: width 0.4s ease;
}
.state-only {
  pointer-events: none;
}
</style>
