<script setup lang="ts">
import { useLocale } from "vuetify";

// A setting about which internets a profile uses, as a card. Off: dashed, in
// the default color, its name and state only. On: in the primary color, its
// internets listed inside (InternetRow, the default slot).
const props = defineProps<{
  on: boolean;
  title: string;
  icon: string;
  disabled?: boolean;
  /** Cannot be switched here (the state slot says why). */
  locked?: boolean;
  /** Not switched from its head (no checkbox): its rows choose. */
  noToggle?: boolean;
  /** Off here, but on through the settings: dashed, in the primary color. */
  inherited?: boolean;
  /** What the head's checkbox shows, when not the same as on (on through
   * the settings, or set here but off). */
  checked?: boolean;
  /** The checkbox shows neither: it follows the settings. */
  indeterminate?: boolean;
  /** Shows the refresh button (lists the internets again). */
  refresh?: boolean;
  loading?: boolean;
  /** Opened from a tip's Set up: stands out for a moment. */
  highlight?: boolean;
  /** Shows a cog to the Multi Internet page (the internets' own settings). */
  settingsLink?: boolean;
}>();
const emit = defineEmits<{ toggle: []; refresh: [] }>();
const { t } = useLocale();

const clickable = computed(() => !props.disabled && !props.locked && !props.noToggle);
const isChecked = computed(() => props.checked ?? props.on);
function toggle() {
  if (clickable.value) emit("toggle");
}
</script>

<template>
  <div
    :class="[
      'internet-card',
      on ? 'internet-card--on' : 'internet-card--off',
      { 'internet-card--inherited': inherited && !on, 'internet-card--disabled': disabled, 'internets-highlight': highlight },
    ]"
  >
    <div
      v-ripple="clickable"
      class="internet-card__head"
      :class="{ 'internet-card__head--click': clickable, 'internet-card__head--plain': noToggle }"
      :role="clickable ? 'switch' : undefined"
      :aria-checked="clickable ? (indeterminate ? 'mixed' : isChecked) : undefined"
      :tabindex="clickable ? 0 : undefined"
      @click="toggle"
      @keydown.enter.prevent="toggle"
      @keydown.space.prevent="toggle"
    >
      <v-checkbox-btn
        v-if="!noToggle"
        class="state-only flex-0-0"
        density="compact"
        :color="isChecked ? 'primary' : undefined"
        :model-value="isChecked"
        :indeterminate="indeterminate"
        :disabled="locked"
        tabindex="-1"
      />
      <v-icon
        size="20"
        class="ms-1 internet-card__icon"
        :color="on || inherited ? 'primary' : undefined">
        {{ icon }}
      </v-icon>
      <div class="internet-card__text">
        <div class="text-body-2 d-flex align-center ga-2">
          {{ title }}
          <slot name="title-append" />
        </div>
        <div class="text-caption d-flex align-center">
          <slot name="state" />
        </div>
      </div>
      <slot name="action" />
      <v-tooltip
        v-if="settingsLink"
        :text="t('$vuetify.title.profile.multiInternetSettingsLink')"
        location="top"
        open-delay="200">
        <template #activator="{ props: tip }">
          <v-btn
            v-bind="tip"
            icon
            size="x-small"
            variant="text"
            density="comfortable"
            to="/multi-internet"
            :aria-label="t('$vuetify.title.profile.multiInternetSettingsLink')"
            @click.stop
          >
            <v-icon size="15">
              mdi-cog-outline
            </v-icon>
          </v-btn>
        </template>
      </v-tooltip>
      <v-tooltip
        v-if="refresh"
        :text="t('$vuetify.title.profile.server.directRefresh')"
        location="top"
        open-delay="200">
        <template #activator="{ props: tip }">
          <v-btn
            v-bind="tip"
            icon
            size="x-small"
            variant="text"
            density="comfortable"
            :loading="loading"
            :disabled="disabled"
            @click.stop="emit('refresh')"
          >
            <v-icon size="15">
              mdi-refresh
            </v-icon>
          </v-btn>
        </template>
      </v-tooltip>
    </div>
    <div
      v-if="$slots.default"
      class="internet-card__rows">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.internet-card {
  border-radius: 12px;
  transition:
    background-color 0.2s,
    border-color 0.2s;
}
.internet-card--off {
  border: 1.5px dashed rgba(var(--v-theme-on-surface), 0.25);
}
.internet-card--on {
  border: 1.5px solid rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.07);
}
.internet-card--inherited {
  border-color: rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.04);
}
.internet-card--disabled {
  opacity: 0.6;
}
/* The checkbox, icon and refresh stay level with the name's line when the
   state below it wraps. */
.internet-card__head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px 8px 6px;
  border-radius: 11px;
  position: relative;
  overflow: hidden;
  outline: none;
}
.internet-card__head--plain {
  padding-inline-start: 12px;
}
.internet-card__head--click {
  cursor: pointer;
}
.internet-card__head--click:focus-visible {
  box-shadow: inset 0 0 0 2px rgba(var(--v-theme-on-surface), 0.3);
}
.internet-card__icon {
  margin-top: 6px;
}
.internet-card__text {
  flex: 1;
  min-width: 0;
  line-height: 1.3;
  padding-top: 5px;
}
.internet-card__rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 10px 10px;
}
/* Shows the state only: the head takes the click. */
.state-only {
  pointer-events: none;
}

/* Opened from a tip's Set up: a pulse of the theme color. */
.internets-highlight {
  animation: internets-pulse 0.8s ease-in-out 3;
}
@keyframes internets-pulse {
  50% {
    background: rgba(var(--v-theme-primary), 0.22);
  }
}
</style>
