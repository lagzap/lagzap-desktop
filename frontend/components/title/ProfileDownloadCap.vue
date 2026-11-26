<script setup lang="ts">
import { useLocale } from "vuetify";
import AppLimitDialog from "~/components/network/bandwidth/AppLimitDialog.vue";
import OverrideSetting from "~/components/common/OverrideSetting.vue";
import { deleteLimit, highTrafficLimit, profileLimit, saveLimit } from "~/composables/useBandwidthControl";
import { formatSpeed } from "~/utils/localeFormat";

/** A high-traffic profile's download cap (OverrideSetting): it follows the
 * global high-traffic cap (Settings) until set here to never capped or its
 * own cap; reset follows the global one again. */
const props = defineProps<{ profileId: string; name: string; disabled?: boolean }>();

const { t } = useLocale();
const bc = (key: string, ...params: unknown[]) => t(`$vuetify.bandwidthControl.${key}`, ...params);
const p = (key: string, ...params: unknown[]) => t(`$vuetify.title.profile.${key}`, ...params);

const own = computed(() => profileLimit(props.profileId));
const dialog = ref(false);

/** The global cap, when it caps. */
const globalCap = computed(() => {
  const limit = highTrafficLimit.value;
  return limit && limit.enabled && limit.download > 0 ? limit.download : 0;
});

type Choice = "off" | "own";
const inUse = computed<Choice>(() =>
  own.value ? (own.value.download <= 0 ? "off" : "own") : globalCap.value > 0 ? "own" : "off",
);
const capLabel = computed(() => {
  if (own.value && own.value.download > 0) return formatSpeed(own.value.download);
  if (!own.value && globalCap.value > 0) return formatSpeed(globalCap.value);
  return bc("capCustom");
});

function pick(next: Choice) {
  if (next === "off") {
    saveLimit({
      id: own.value?.id ?? crypto.randomUUID(),
      kind: "profile",
      path: props.profileId,
      download: 0,
      only_while_gaming: false,
      enabled: true,
    });
  } else {
    dialog.value = true;
  }
}
function reset() {
  if (own.value) deleteLimit(own.value.id);
}

const items = computed(() => [
  { value: "off" as Choice, title: bc("capNever") },
  // Clicking the cap in use edits it (as this profile's own).
  { value: "own" as Choice, title: capLabel.value, icon: "mdi-speedometer-slow", onClick: () => (dialog.value = true) },
]);
</script>

<template>
  <div>
    <OverrideSetting
      :label="bc('downloadCap')"
      icon="mdi-speedometer-slow"
      :hint="bc('highTrafficSettingHint')"
      :items="items"
      :value="inUse"
      :custom="!!own"
      :source="p('followingGlobal')"
      source-icon="mdi-earth"
      :source-value="globalCap > 0 ? formatSpeed(globalCap) : bc('capNever')"
      :disabled="disabled"
      @pick="pick"
      @reset="reset"
    />

    <AppLimitDialog
      v-model="dialog"
      :path="profileId"
      :name="name"
      :limit="own && own.download > 0 ? own : null"
      fixed="profile"
      @save="(limit) => saveLimit({ ...limit, id: own?.id ?? limit.id })"
      @remove="deleteLimit"
    />
  </div>
</template>
