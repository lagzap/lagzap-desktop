<script setup lang="ts" generic="T extends string">
import { useLocale } from "vuetify";
import PillToggle from "~/components/common/PillToggle.vue";

/** A setting an app follows from the global one (or its game's) unless it
 * sets its own. The pills always show the value in use: in the default color
 * while it follows, in the primary color once set for this app — then a
 * reset button takes it back to following. Picking a value sets it for this
 * app, even the same one the global has. */
const props = defineProps<{
  label: string;
  /** Shown before the label. */
  icon?: string;
  /** What it does: behind a ? after the label. */
  hint?: string;
  items: { value: T; title: string; icon?: string; onClick?: () => void }[];
  /** The value in use: the app's own, or the followed one. */
  value: T;
  /** Set for this app. */
  custom: boolean;
  /** What it follows: Global, or its game's name. */
  source: string;
  sourceIcon: string;
  /** The followed value's name, for the reset button's tooltip. */
  sourceValue: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ pick: [value: T]; reset: [] }>();
const { t } = useLocale();
const p = (key: string, ...params: unknown[]) => t(`$vuetify.title.profile.${key}`, ...params);

const choice = computed<T>({
  get: () => props.value,
  set: (next) => emit("pick", next),
});
/** Picking the value in use while following makes it the app's own too. */
const items = computed(() =>
  props.items.map((item) =>
    !props.custom && item.value === props.value && !item.onClick
      ? { ...item, onClick: () => emit("pick", item.value) }
      : item,
  ),
);
</script>

<template>
  <div class="override-setting">
    <div class="d-flex align-center ga-2">
      <v-icon
        v-if="icon"
        :icon="icon"
        size="20"
        class="override-setting__icon" />
      <div class="override-setting__text">
        <div class="text-body-2 d-flex align-center">
          <span
            class="override-setting__label"
            :title="label">{{ label }}</span>
          <v-tooltip
            v-if="hint"
            :text="hint"
            location="top"
            max-width="300"
            open-delay="150">
            <template #activator="{ props: tip }">
              <v-icon
                v-bind="tip"
                icon="mdi-help-circle-outline"
                size="16"
                class="override-setting__help"
                :aria-label="hint"
              />
            </template>
          </v-tooltip>
        </div>
      </div>
      <v-tooltip
        v-if="custom"
        :text="p('resetTo', `${source} · ${sourceValue}`)"
        location="top"
        open-delay="200">
        <template #activator="{ props: tip }">
          <v-btn
            v-bind="tip"
            icon
            size="x-small"
            variant="text"
            density="comfortable"
            :disabled="disabled"
            :aria-label="p('resetTo', `${source} · ${sourceValue}`)"
            @click="emit('reset')"
          >
            <v-icon size="16">
              mdi-backup-restore
            </v-icon>
          </v-btn>
        </template>
      </v-tooltip>
      <PillToggle
        v-model="choice"
        :items="items"
        :color="custom ? 'primary' : undefined"
        :disabled="disabled" />
    </div>
  </div>
</template>

<style scoped>
.override-setting__icon {
  flex: none;
  opacity: 0.8;
}
/* One line, cut with … when long (its full name on hover). */
.override-setting__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The ? after the label, with room before it. */
.override-setting__help {
  flex: none;
  margin-inline-start: 6px;
  opacity: 0.6;
  cursor: help;
}
.override-setting__text {
  flex: 1;
  min-width: 0;
  line-height: 1.3;
}
</style>
