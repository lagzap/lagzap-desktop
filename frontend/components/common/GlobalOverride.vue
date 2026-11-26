<script setup lang="ts">
import { useLocale } from "vuetify";
import OverrideSetting from "~/components/common/OverrideSetting.vue";

/** An on/off setting that follows a global value unless this app sets its
 * own (OverrideSetting): On and Off show the value in use, in the primary
 * color once set for this app, with a reset back to following. null is
 * "follow the global". */
const props = defineProps<{
  label: string;
  icon?: string;
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

type Choice = "on" | "off";
const inUse = computed<Choice>(() => ((value.value ?? props.global) ? "on" : "off"));
const items = computed(() => [
  { value: "on" as Choice, title: p("overrideOn") },
  { value: "off" as Choice, title: p("overrideOff") },
]);
</script>

<template>
  <OverrideSetting
    :label="label"
    :icon="icon"
    :hint="hint"
    :items="items"
    :value="inUse"
    :custom="value !== null"
    :source="followName || p('followingGlobal')"
    :source-icon="followName ? 'mdi-link-variant' : 'mdi-earth'"
    :source-value="global ? p('overrideOn') : p('overrideOff')"
    :disabled="disabled"
    @pick="(next: Choice) => (value = next === 'on')"
    @reset="value = null"
  />
</template>
