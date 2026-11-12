<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLocale } from "vuetify";
import { useAccessOffer } from "~/composables/useAccessOffer";
import { reasonKey } from "~/utils/accessOffer";
import { localDigits } from "~/utils/localeFormat";

/** "Get a free trial with Discord": one click opens Discord's login in the
 * browser; the server links the account, adds it to our server and starts
 * the plan. Meanwhile this shows "Finish in your browser" and polls /data. */
const { t } = useLocale();
const { offer, screenOpen, waiting, loginExpired, startDiscord, reopenLogin } = useAccessOffer();

const starting = ref(false);
/** Why the last start was refused (empty: it was not). */
const refusal = ref("");

const isTrial = computed(() => offer.value?.kind === "trial");
const offerName = computed(() => t(isTrial.value ? "$vuetify.accessOffer.nameTrial" : "$vuetify.accessOffer.nameBeta"));
const title = computed(() =>
  t(
    isTrial.value ? "$vuetify.accessOffer.trialTitle" : "$vuetify.accessOffer.betaTitle",
    localDigits(offer.value?.duration_days ?? 0),
  ),
);

const reason = computed(() => reasonKey(refusal.value || offer.value?.blocked_reason));
const reasonText = computed(() => (reason.value ? t(`$vuetify.accessOffer.blocked.${reason.value}`, offerName.value) : ""));
/** Nothing to try: the offer is gone or already used here. */
const final = computed(() => !!offer.value && (!offer.value.can_start || offer.value.claimed));

watch(screenOpen, (open) => {
  if (open) refusal.value = "";
});

async function onStart() {
  if (starting.value) return;
  starting.value = true;
  try {
    refusal.value = await startDiscord();
    // Already has a plan: nothing to offer.
    if (refusal.value === "has_plan") screenOpen.value = false;
  } finally {
    starting.value = false;
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
        <v-card-title>{{ title }}</v-card-title>
      </v-card-item>

      <v-card-text class="d-flex flex-column ga-4">
        <div v-if="waiting" class="access-offer__wait">
          <v-progress-circular indeterminate color="primary" size="28" width="3" />
          <div class="flex-grow-1 min-w-0">
            <div class="text-body-1 font-weight-medium">{{ t("$vuetify.accessOffer.waitingTitle") }}</div>
            <div class="text-caption text-medium-emphasis">{{ t("$vuetify.accessOffer.waitingText") }}</div>
          </div>
        </div>
        <div v-else class="text-body-2">{{ t("$vuetify.accessOffer.intro") }}</div>

        <v-alert v-if="reasonText" type="warning" variant="tonal" density="compact" :text="reasonText" />
        <v-alert
          v-else-if="loginExpired"
          type="info"
          variant="tonal"
          density="compact"
          :text="t('$vuetify.accessOffer.loginExpired')"
        />
      </v-card-text>

      <v-card-actions>
        <v-btn variant="text" @click="screenOpen = false">
          {{ waiting ? t("$vuetify.accessOffer.cancel") : t("$vuetify.accessOffer.later") }}
        </v-btn>
        <v-spacer />
        <template v-if="waiting">
          <v-btn variant="tonal" rounded="lg" class="text-none" prepend-icon="mdi-open-in-new" @click="reopenLogin">
            {{ t("$vuetify.accessOffer.openAgain") }}
          </v-btn>
          <v-btn v-if="reasonText" variant="flat" color="primary" rounded="lg" class="text-none" :loading="starting" @click="onStart">
            {{ t("$vuetify.accessOffer.tryAgain") }}
          </v-btn>
        </template>
        <v-btn
          v-else-if="!final"
          variant="flat"
          color="primary"
          rounded="lg"
          class="text-none"
          prepend-icon="mdi-open-in-new"
          :loading="starting"
          @click="onStart"
        >
          {{
            reasonText || loginExpired
              ? t("$vuetify.accessOffer.tryAgain")
              : isTrial
                ? t("$vuetify.accessOffer.startTrial")
                : t("$vuetify.accessOffer.startBeta")
          }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.access-offer__wait {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: thin solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
}
</style>
