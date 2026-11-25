<script setup lang="ts">
import { useLocale } from "vuetify";
import AppLimitDialog from "~/components/network/bandwidth/AppLimitDialog.vue";
import { deleteLimit, highTrafficLimit, limitActiveNow, profileLimit, saveLimit } from "~/composables/useBandwidthControl";
import { formatSpeed } from "~/utils/localeFormat";

/** A high-traffic profile's download cap, by its name: any user can cap it,
 * with or without a plan (direct traffic is capped too). Opens the cap
 * dialog (global, off or its own cap); lit while a cap applies. */
const props = withDefaults(
  defineProps<{
    profileId: string;
    name: string;
    /** The main card: a regular icon button beside Settings. */
    regular?: boolean;
  }>(),
  { regular: false },
);

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
/** Set, but "only while gaming" and no game running: it waits, and says so. */
const waiting = computed(() => {
  if (cap.value <= 0) return false;
  const rule = own.value ?? highTrafficLimit.value;
  return !!rule && !limitActiveNow(rule);
});
const globalLabel = computed(() =>
  t("$vuetify.title.profile.followGlobal", globalCap.value > 0 ? formatSpeed(globalCap.value) : t("$vuetify.title.profile.overrideOff")),
);
const tip = computed(() => {
  if (cap.value <= 0) return t("$vuetify.bandwidthControl.downloadCap");
  const text = `${t("$vuetify.bandwidthControl.downloadCap")}: ${formatSpeed(cap.value)}`;
  return waiting.value ? `${text}. ${t("$vuetify.bandwidthControl.capWaitsForGame")}` : text;
});
</script>

<template>
  <v-tooltip :text="tip" location="top" open-delay="300">
    <template #activator="{ props: tipProps }">
      <!-- The main card, capped: the cap itself, plain, no color. -->
      <v-btn
        v-if="regular && cap > 0"
        v-bind="tipProps"
        variant="text"
        color="on-surface"
        prepend-icon="mdi-speedometer-slow"
        class="text-none"
        :disabled="!store.appReady"
        :aria-label="t('$vuetify.bandwidthControl.downloadCap')"
        @click.stop="open = true"
      >
        {{ formatSpeed(cap) }}
        <span v-if="waiting" class="text-medium-emphasis ms-1">· {{ t("$vuetify.bandwidthControl.whileGamingShort") }}</span>
      </v-btn>
      <v-btn
        v-else
        v-bind="tipProps"
        icon="mdi-speedometer-slow"
        :size="regular ? 'default' : 'x-small'"
        variant="text"
        :density="regular ? 'default' : 'comfortable'"
        :color="regular ? 'on-surface' : cap > 0 ? 'amber' : 'medium-emphasis'"
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
