<script setup lang="ts">
import { useLocale } from "vuetify";
import AppLimitDialog from "~/components/network/bandwidth/AppLimitDialog.vue";
import { deleteLimit, highTrafficLimit, profileLimit, saveLimit } from "~/composables/useBandwidthControl";
import { formatSpeed } from "~/utils/localeFormat";

/** A high-traffic profile's download cap, by its name: any user can cap it,
 * with or without a plan (direct traffic is capped too). Opens the cap
 * dialog (global, off or its own cap); lit while a cap applies. */
const props = defineProps<{ profileId: string; name: string }>();

const { t } = useLocale();
const store = useStore();
const open = ref(false);
// Bandwidth Control's "Through LagZap" asked for this profile's cap.
const titleMenu = useTitleMenu();
onMounted(() => {
  if (titleMenu.takeProfile(props.profileId, "cap")) setTimeout(() => (open.value = true), 150);
});

const own = computed(() => profileLimit(props.profileId));
const globalCap = computed(() => {
  const global = highTrafficLimit.value;
  return global && global.enabled ? global.download : 0;
});
/** The cap in force (bytes/s), 0 when none. */
const cap = computed(() => {
  if (own.value) return own.value.enabled && own.value.download > 0 ? own.value.download : 0;
  return globalCap.value;
});
const globalLabel = computed(() =>
  t("$vuetify.title.profile.followGlobal", globalCap.value > 0 ? formatSpeed(globalCap.value) : t("$vuetify.title.profile.overrideOff")),
);
const tip = computed(() =>
  cap.value > 0
    ? `${t("$vuetify.bandwidthControl.downloadCap")}: ${formatSpeed(cap.value)}`
    : t("$vuetify.bandwidthControl.downloadCap"),
);
</script>

<template>
  <v-tooltip :text="tip" location="top" open-delay="300">
    <template #activator="{ props: tipProps }">
      <v-btn
        v-bind="tipProps"
        icon="mdi-speedometer-slow"
        size="x-small"
        variant="text"
        density="comfortable"
        :color="cap > 0 ? 'amber' : 'medium-emphasis'"
        :disabled="!store.appReady"
        :aria-label="t('$vuetify.bandwidthControl.downloadCap')"
        @click.stop="open = true"
      />
    </template>
  </v-tooltip>
  <AppLimitDialog
    v-model="open"
    :path="profileId"
    :name="name"
    :limit="own"
    fixed="profile"
    :global-label="globalLabel"
    @save="(limit) => saveLimit({ ...limit, id: own?.id ?? limit.id })"
    @remove="deleteLimit"
  />
</template>
