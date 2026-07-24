<script lang="ts" setup>
import { useLocale } from "vuetify";
import { useNetworkHistoryConsent } from "~/composables/useNetworkHistoryConsent";

const locale = useLocale();
const { t } = locale;
const { isAdmin, granted, setGranted } = useNetworkHistoryConsent();
</script>

<template>
  <v-card
    v-if="isAdmin"
    :title="t('$vuetify.settings.networkReport.title')"
    flat
    class="mt-3 bg-transparent"
    max-width="500"
  >
    <v-card-text class="pb-2">
      <p class="text-body-2 text-medium-emphasis mb-3">
        {{ t("$vuetify.settings.networkReport.description") }}
      </p>
      <v-switch
        :model-value="granted"
        color="primary"
        density="comfortable"
        hide-details
        class="mb-3"
        :label="t('$vuetify.settings.networkReport.enableRecording')"
        @update:model-value="setGranted(!!$event)"
      />
      <p class="text-caption text-medium-emphasis mb-3">
        {{ t("$vuetify.settings.networkReport.permissionHint") }}
      </p>
      <v-btn
        color="primary"
        rounded="lg"
        :disabled="!granted"
        :to="{ name: 'network-report' }"
      >
        {{ t("$vuetify.settings.networkReport.open") }}
      </v-btn>
    </v-card-text>
  </v-card>
</template>
