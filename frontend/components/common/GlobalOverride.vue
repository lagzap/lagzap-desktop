<script setup lang="ts">
import { useLocale } from "vuetify";
import PillToggle from "~/components/common/PillToggle.vue";

/** An on/off setting that follows a global value unless this app sets its
 * own. The "Global" choice says what the global value is now, and a Custom
 * chip marks an app that set its own. null is "follow the global". */
const props = defineProps<{
  label: string;
  hint?: string;
  /** The global value right now (or the title's, with followName). */
  global: boolean;
  /** Follows the title (this name), not the global setting. */
  followName?: string;
  disabled?: boolean;
}>();
const value = defineModel<boolean | null>({ default: null });

const { t } = useLocale();
const p = (key: string, ...params: unknown[]) => t(`$vuetify.title.profile.${key}`, ...params);

type Choice = "global" | "on" | "off";
const choice = computed<Choice>({
  get: () => (value.value === null ? "global" : value.value ? "on" : "off"),
  set: (next) => {
    value.value = next === "global" ? null : next === "on";
  },
});
const items = computed(() => [
  {
    value: "global" as Choice,
    title: props.followName
      ? `${props.followName} · ${props.global ? p("overrideOn") : p("overrideOff")}`
      : p("followGlobal", props.global ? p("overrideOn") : p("overrideOff")),
    icon: props.followName ? "mdi-link-variant" : "mdi-earth",
  },
  { value: "on" as Choice, title: p("overrideOn") },
  { value: "off" as Choice, title: p("overrideOff") },
]);
</script>

<template>
  <div class="global-override">
    <div class="d-flex align-center ga-2 mb-1">
      <span class="text-body-2">
        {{ label }}
      </span>
      <v-tooltip
        v-if="value !== null"
        :text="p('customHint')"
        location="top"
        open-delay="300">
        <template #activator="{ props: tip }">
          <v-chip
            v-bind="tip"
            color="warning"
            size="x-small"
            variant="tonal"
            prepend-icon="mdi-tune-variant"
          >
            {{ p("custom") }}
          </v-chip>
        </template>
      </v-tooltip>
    </div>
    <PillToggle
      v-model="choice"
      :items="items"
      :disabled="disabled" />
    <div
      v-if="hint"
      class="text-caption text-medium-emphasis mt-1">
      {{ hint }}
    </div>
  </div>
</template>
