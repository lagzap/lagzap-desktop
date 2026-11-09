<script setup lang="ts">
import { computed } from "vue";
import { useLocale } from "vuetify";
import { usePlanAccess } from "~/composables/usePlanAccess";

/** Shown at the top of every page when no game can be routed: no active
 * plan, an expired one, or one that could not be loaded. A full-width
 * banner like the title page's "not active" one. */
const { t } = useLocale();
const { access, active, status, canUpgrade, openUpgrade } = usePlanAccess();

const show = computed(() => !!access.value && !active.value && status.value !== "loading");
const text = computed(() => {
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

      <template v-if="canUpgrade && status !== 'unavailable'" #actions>
        <v-btn variant="tonal" prepend-icon="mdi-cart-outline" @click="openUpgrade">
          {{ t("$vuetify.plan.getPlan") }}
        </v-btn>
      </template>
    </v-banner>
  </v-expand-transition>
</template>

<style scoped>
.plan-banner :deep(.v-banner-text) {
  padding-inline-end: 8px;
}
</style>
