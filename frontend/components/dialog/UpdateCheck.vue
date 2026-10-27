<script setup lang="ts">
import { useLocale } from "vuetify";

const { t } = useLocale();
const { dialogOpen, status, error, checking, dismissUpdateCheck } =
  useUpdateCheck(t);

const persistent = computed(() => status.value === "checking");
</script>

<template>
  <v-dialog
    :model-value="dialogOpen"
    :persistent="persistent"
    max-width="360"
    scrim="black"
    opacity="0.55"
  >
    <v-card class="update-check-dialog" rounded="lg">
      <v-card-text class="update-check-dialog__body text-center">
        <template v-if="checking || status === 'checking'">
          <v-progress-circular
            indeterminate
            color="primary"
            size="44"
            width="3"
            class="mb-4"
          />
          <div class="text-body-1 font-weight-medium">
            {{ t("$vuetify.settings.checkingForUpdate") }}
          </div>
          <div class="text-caption text-medium-emphasis mt-2">
            {{ t("$vuetify.settings.checkingForUpdateHint") }}
          </div>
        </template>

        <template v-else-if="status === 'up-to-date'">
          <v-icon
            icon="mdi-check-circle-outline"
            color="success"
            size="48"
            class="mb-3"
          />
          <div class="text-body-1 font-weight-medium">
            {{ t("$vuetify.settings.upToDate") }}
          </div>
        </template>

        <template v-else-if="status === 'error'">
          <v-icon
            icon="mdi-alert-circle-outline"
            color="error"
            size="48"
            class="mb-3"
          />
          <div class="text-body-1 font-weight-medium mb-2">
            {{ t("$vuetify.settings.updateCheckFailed") }}
          </div>
          <div class="text-body-2 text-medium-emphasis">
            {{ error || t("$vuetify.settings.updateCheckFailed") }}
          </div>
          <v-btn
            class="mt-5"
            variant="tonal"
            color="primary"
            @click="dismissUpdateCheck"
          >
            {{ t("$vuetify.close") }}
          </v-btn>
        </template>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.update-check-dialog {
  background-color: rgb(var(--v-theme-surface)) !important;
}

.update-check-dialog__body {
  padding: 1.75rem 1.5rem 1.5rem !important;
}
</style>
