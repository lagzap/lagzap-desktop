<script setup lang="ts">
import { useLocale } from "vuetify";
import AppLimitDialog from "~/components/network/bandwidth/AppLimitDialog.vue";
import PillToggle from "~/components/common/PillToggle.vue";
import { deleteLimit, highTrafficLimit, profileLimit, saveLimit } from "~/composables/useBandwidthControl";
import { formatSpeed } from "~/utils/localeFormat";

/** A high-traffic profile's download cap: the global high-traffic cap
 * (Settings), never capped, or its own cap. A Custom chip marks a profile
 * that does not follow the global one. */
const props = defineProps<{ profileId: string; name: string; disabled?: boolean }>();

const { t } = useLocale();
const bc = (key: string, ...params: unknown[]) => t(`$vuetify.bandwidthControl.${key}`, ...params);
const p = (key: string, ...params: unknown[]) => t(`$vuetify.title.profile.${key}`, ...params);

const own = computed(() => profileLimit(props.profileId));
const dialog = ref(false);

const globalLabel = computed(() => {
  const limit = highTrafficLimit.value;
  const value = limit && limit.enabled ? formatSpeed(limit.download) : p("overrideOff");
  return p("followGlobal", value);
});

const ownLabel = computed(() =>
  own.value && own.value.download > 0 ? formatSpeed(own.value.download) : bc("capCustom"),
);

type Choice = "global" | "off" | "own";
const choice = computed<Choice>({
  get: () => (!own.value ? "global" : own.value.download <= 0 ? "off" : "own"),
  set: (next) => {
    if (next === "global") {
      if (own.value) deleteLimit(own.value.id);
    } else if (next === "off") {
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
  },
});

const items = computed(() => [
  { value: "global" as Choice, title: globalLabel.value, icon: "mdi-earth" },
  { value: "off" as Choice, title: bc("capNever") },
  // Clicking the chosen own cap again edits it.
  { value: "own" as Choice, title: ownLabel.value, icon: "mdi-speedometer-slow", onClick: () => (dialog.value = true) },
]);
</script>

<template>
  <div>
    <div class="d-flex align-center ga-2 mb-1">
      <span class="text-body-2">
        {{ bc("downloadCap") }}
      </span>
      <v-tooltip
        v-if="own"
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
    <div class="text-caption text-medium-emphasis mt-1">
      {{ bc("highTrafficSettingHint") }}
    </div>

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
