<script setup lang="ts">
import { computed, ref } from "vue";
import { useLocale } from "vuetify";
import { PLAN_STATUS_COLOR, useAccountPlan } from "~/composables/useAccountPlan";
import { localDigits } from "~/utils/localeFormat";
import SensitiveText from "~/components/common/SensitiveText.vue";
import TeamPlanBadge from "~/components/team/TeamPlanBadge.vue";
import GamerTagDialog from "~/components/account/GamerTagDialog.vue";

/** Who is signed in, and their plan at a glance. Email and phone are personal:
 * never shown as the name, only behind a spoiler (streamers keep the app on
 * screen). */
const { t } = useLocale();
const { subscriber, name: planName, status } = useAccountPlan();
const editingTag = ref(false);

const displayName = computed(() => subscriber.value?.name?.trim() || "");
const initials = computed(() => {
  const words = displayName.value.split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
});
const contacts = computed(() =>
  [subscriber.value?.email, subscriber.value?.phone ? localDigits(`+${subscriber.value.phone}`) : ""].filter(
    (c): c is string => !!c,
  ),
);

const copied = ref(false);
async function copyId() {
  const id = subscriber.value?.id;
  if (!id) return;
  try {
    await navigator.clipboard.writeText(id);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
  } catch {
    // clipboard refused: nothing to show
  }
}
</script>

<template>
  <section class="lz-panel account-header">
    <v-avatar size="64" color="primary" variant="tonal" class="account-header__avatar">
      <span v-if="initials" class="text-h6 font-weight-bold">{{ initials }}</span>
      <v-icon v-else icon="mdi-account" size="32" />
    </v-avatar>

    <div class="min-w-0 flex-grow-1">
      <div class="d-flex align-center ga-1 min-w-0">
        <span class="text-h6 font-weight-medium text-truncate">{{ displayName || t("$vuetify.status.player1") }}</span>
        <v-btn
          icon="mdi-pencil-outline"
          variant="text"
          size="x-small"
          :aria-label="t('$vuetify.gamerTag.change')"
          @click="editingTag = true"
        />
        <GamerTagDialog v-model="editingTag" />
      </div>
      <div v-if="contacts.length" class="text-body-2 text-medium-emphasis d-flex flex-wrap ga-2">
        <template v-for="(contact, i) in contacts" :key="i">
          <span v-if="i > 0">·</span>
          <SensitiveText :text="contact" />
        </template>
      </div>
      <div class="d-flex flex-wrap align-center ga-2 mt-2">
        <v-chip v-if="planName" size="small" variant="tonal" rounded="pill" color="primary" prepend-icon="mdi-crown-outline">
          {{ planName }}
        </v-chip>
        <TeamPlanBadge />
        <v-chip v-if="status !== 'loading'" size="small" variant="tonal" rounded="pill" :color="PLAN_STATUS_COLOR[status] ?? 'grey'">
          {{ t(`$vuetify.profile.status.${status}`) }}
        </v-chip>
      </div>
    </div>

    <v-tooltip
      v-if="subscriber?.id"
      :text="copied ? t('$vuetify.profile.copied') : t('$vuetify.profile.copyId')"
      location="top"
    >
      <template #activator="{ props }">
        <v-chip
          v-bind="props"
          size="small"
          variant="tonal"
          :prepend-icon="copied ? 'mdi-check' : 'mdi-identifier'"
          class="account-header__id"
          @click="copyId"
        >
          {{ subscriber.id.slice(0, 8) }}
        </v-chip>
      </template>
    </v-tooltip>
  </section>
</template>

<style scoped>
/* One row, start-aligned: avatar, who it is, then the ID. (.lz-panel
   stacks its children; this one must not.) */
.account-header {
  flex-direction: row;
  align-items: center;
  gap: 16px;
}

.account-header__id {
  font-family: monospace;
  flex: 0 0 auto;
  align-self: flex-start;
}
</style>
