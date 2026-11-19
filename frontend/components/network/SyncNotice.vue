<script setup lang="ts">
import { useLocale } from "vuetify";

/** While a data sync step keeps failing and is retried, a notice says so
 * (under the title bar); it goes once the sync completes. During startup the
 * splash's own message says it instead. */
const { t } = useLocale();
const store = useStore();

const shown = computed(() => store.appReady && !!store.syncProblem);
const text = computed(() =>
  store.syncProblem?.failed
    ? t("$vuetify.service.syncFailed")
    : t("$vuetify.service.syncRetrying", store.syncProblem?.step ?? ""),
);
</script>

<template>
  <v-snackbar
    :model-value="shown"
    :timeout="-1"
    location="top"
    color="warning"
    variant="tonal"
    rounded="lg"
    class="sync-notice"
  >
    <div class="d-flex align-center ga-3">
      <v-progress-circular indeterminate size="18" width="2" />
      <span>{{ text }}</span>
    </div>
  </v-snackbar>
</template>

<style scoped>
.sync-notice :deep(.v-snackbar__wrapper) {
  /* Below the window's title bar (the tallest app bar is 56px). */
  margin-top: 64px;
  backdrop-filter: blur(8px);
  background: rgb(var(--v-theme-surface) / 0.92);
}
</style>
