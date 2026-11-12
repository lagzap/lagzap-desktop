<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLocale } from "vuetify";
import { FIXABLE_REFUSALS, useAccessOffer } from "~/composables/useAccessOffer";
import { localDigits } from "~/utils/localeFormat";
import SensitiveText from "~/components/common/SensitiveText.vue";

/** "Join the beta" / "Start free trial": connect Discord (and join the
 * server), then claim. The /data poll runs every 5 seconds while it is open. */
const { t } = useLocale();
const { offer, screenOpen, discordDone, startPolling, stopPolling, connectDiscord, claim } = useAccessOffer();

const claiming = ref(false);
const refusal = ref("");

const isTrial = computed(() => offer.value?.kind === "trial");
const KNOWN = [
  "account_used",
  "discord_used",
  "device_used",
  "discord_not_linked",
  "discord_not_member",
  "discord_too_new",
  "has_plan",
  "no_campaign",
  "unknown_device",
  "revoked",
  "unreachable",
];
const blocked = computed(() => refusal.value || offer.value?.blocked_reason || "");
const final = computed(() => !!blocked.value && !FIXABLE_REFUSALS.includes(blocked.value));
const blockedText = computed(() =>
  t(`$vuetify.accessOffer.blocked.${KNOWN.includes(blocked.value) ? blocked.value : "other"}`),
);
const discordStep = computed(() => {
  const d = offer.value?.discord;
  if (!d?.linked) return t("$vuetify.accessOffer.discordConnect");
  if (!d.member) return t("$vuetify.accessOffer.discordJoin");
  return t("$vuetify.accessOffer.discordDone");
});

watch(
  screenOpen,
  (open) => {
    if (open) {
      refusal.value = "";
      startPolling();
    } else {
      stopPolling();
    }
  },
  { immediate: true },
);
// Discord step finished after a "not linked / not a member" refusal.
watch(discordDone, (done) => {
  if (done && FIXABLE_REFUSALS.includes(refusal.value)) refusal.value = "";
});
// Claimed: the plan has started, nothing left to show.
watch(
  () => offer.value?.claimed,
  (claimed) => {
    if (claimed) screenOpen.value = false;
  },
);

async function onClaim() {
  if (claiming.value) return;
  claiming.value = true;
  try {
    refusal.value = await claim();
  } finally {
    claiming.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="screenOpen" max-width="460">
    <v-card v-if="offer" class="access-offer" rounded="xl">
      <v-card-item>
        <template #prepend>
          <v-avatar color="primary" variant="tonal" :icon="isTrial ? 'mdi-timer-sand' : 'mdi-flask-outline'" />
        </template>
        <v-card-title>{{ isTrial ? t("$vuetify.accessOffer.trialTitle") : t("$vuetify.accessOffer.betaTitle") }}</v-card-title>
        <v-card-subtitle>
          {{ t("$vuetify.accessOffer.duration", localDigits(offer.duration_days)) }}
        </v-card-subtitle>
      </v-card-item>

      <v-card-text class="d-flex flex-column ga-4">
        <div class="access-offer__step">
          <v-icon
            :icon="discordDone ? 'mdi-check-circle' : 'mdi-numeric-1-circle-outline'"
            :color="discordDone ? 'success' : undefined"
          />
          <div class="flex-grow-1 min-w-0">
            <div class="text-body-1 font-weight-medium">{{ t("$vuetify.accessOffer.discordStep") }}</div>
            <div class="text-caption text-medium-emphasis">{{ discordStep }}</div>
            <div v-if="offer.discord.linked && offer.discord.username" class="text-caption text-medium-emphasis">
              {{ t("$vuetify.accessOffer.discordAs") }} <SensitiveText :text="offer.discord.username" />
            </div>
          </div>
          <v-btn
            v-if="!discordDone"
            variant="tonal"
            color="primary"
            rounded="lg"
            class="text-none"
            prepend-icon="mdi-open-in-new"
            :disabled="!offer.discord.link_url"
            @click="connectDiscord"
          >
            {{ t("$vuetify.accessOffer.connectDiscord") }}
          </v-btn>
        </div>

        <v-alert v-if="blocked" type="warning" variant="tonal" density="compact" :text="blockedText" />
      </v-card-text>

      <v-card-actions>
        <v-btn variant="text" @click="screenOpen = false">{{ t("$vuetify.accessOffer.later") }}</v-btn>
        <v-spacer />
        <v-btn
          v-if="!final"
          variant="flat"
          color="primary"
          rounded="lg"
          class="text-none"
          :loading="claiming"
          :disabled="!offer.claimable"
          @click="onClaim"
        >
          {{ isTrial ? t("$vuetify.accessOffer.claimTrial") : t("$vuetify.accessOffer.claimBeta") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.access-offer__step {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: thin solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
}
</style>
