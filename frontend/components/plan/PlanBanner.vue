<script setup lang="ts">
import { computed, ref } from "vue";
import { useLocale } from "vuetify";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { useAccessOffer } from "~/composables/useAccessOffer";

/** Shown at the top of every page when no game can be routed: no active
 * plan, an expired one, or one that could not be loaded. A full-width
 * banner like the title page's "not active" one. */
const { t } = useLocale();
const { access, active, status, canUpgrade, openUpgrade } = usePlanAccess();
const { offer, open: offerOpen, suspended, screenOpen, connectDiscord } = useAccessOffer();

// Beta or trial access paused (or run out) because the user left the
// Discord server: ask them back instead of selling a plan.
const rejoin = computed(
  () => suspended.value || (status.value === "expired" && !!offer.value && !offer.value.discord.member),
);

// An offer waiting shows here too, for free accounts as well. Closing it
// hides the banner until the app restarts (offerBannerClosed lives for the
// app's lifetime).
const offerShown = computed(() => offerOpen.value && !offerBannerClosed.value);
const show = computed(
  () =>
    rejoin.value ||
    offerShown.value ||
    (!offerBannerClosed.value && !!access.value && !active.value && status.value !== "loading"),
);
const text = computed(() => {
  if (rejoin.value) return t("$vuetify.accessOffer.rejoin");
  if (offerShown.value) return offer.value?.kind === "trial" ? t("$vuetify.accessOffer.bannerTrial") : t("$vuetify.accessOffer.bannerBeta");
  switch (status.value) {
    case "unavailable":
      return t("$vuetify.plan.unavailable");
    case "expired":
      return t("$vuetify.plan.expired");
    default:
      return t("$vuetify.plan.none");
  }
});
</script>

<template>
  <v-expand-transition>
    <v-banner
      v-if="show"
      color="warning"
      lines="one"
      class="plan-banner"
    >
      <template #prepend>
        <v-avatar color="warning" variant="tonal" icon="mdi-alert-circle-outline" />
      </template>
      <v-banner-text>{{ text }}</v-banner-text>

      <template v-if="rejoin" #actions>
        <v-btn variant="tonal" prepend-icon="mdi-open-in-new" :disabled="!offer?.discord.link_url" @click="connectDiscord">
          {{ t("$vuetify.accessOffer.connectDiscord") }}
        </v-btn>
      </template>
      <template v-else-if="offerShown" #actions>
        <v-btn variant="tonal" prepend-icon="mdi-gift-outline" @click="screenOpen = true">
          {{ offer?.kind === "trial" ? t("$vuetify.accessOffer.claimTrial") : t("$vuetify.accessOffer.claimBeta") }}
        </v-btn>
        <v-btn
          icon="mdi-close"
          variant="text"
          size="small"
          class="ms-1"
          :aria-label="t('$vuetify.accessOffer.dismiss')"
          @click="offerBannerClosed = true"
        />
      </template>
      <template v-else-if="canUpgrade && status !== 'unavailable'" #actions>
        <v-btn variant="tonal" prepend-icon="mdi-cart-outline" @click="openUpgrade">
          {{ t("$vuetify.plan.getPlan") }}
        </v-btn>
      </template>
    </v-banner>
  </v-expand-transition>
</template>

<script lang="ts">
/** Closed offer banner, shared by every page until the app restarts. */
const offerBannerClosed = ref(false);
</script>

<style scoped>
.plan-banner :deep(.v-banner-text) {
  padding-inline-end: 8px;
}
</style>
