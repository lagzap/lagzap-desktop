<script setup lang="ts">
import { useLocale } from "vuetify";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { useProfileMultipath } from "~/composables/useProfileMultipath";

/** A game profile on one route: multipath is off. Says to use more routes,
 * or, when the plan has one, offers the plans that have more. Shown only
 * while it is off. dismissable: a tip on the profile card the user may
 * close (route settings always shows it). */
const props = defineProps<{ profile: Profile; dismissable?: boolean }>();

const { t } = useLocale();
const plan = usePlanAccess();
const { multipathOff, routesInPlan } = useProfileMultipath(() => props.profile);
const { hintShown, dismissHint } = useSettings();
const hintKey = computed(() => `multipathOff.${props.profile.id}`);
const shown = computed(() => multipathOff.value && (!props.dismissable || hintShown(hintKey.value)));
</script>

<template>
  <v-scale-transition>
    <div v-if="shown" class="multipath-hint">
      <div class="multipath-hint__badge">
        <v-icon icon="mdi-routes" size="20" />
      </div>
      <div class="multipath-hint__text">
        <div class="d-flex align-center flex-wrap ga-2">
          <span class="text-body-2 font-weight-medium">
            {{ t("$vuetify.title.profile.multiPathDisabled") }}
          </span>
          <v-chip v-if="!routesInPlan" size="x-small" variant="tonal" color="amber">
            {{ t("$vuetify.title.multiInternetHint.premium") }}
          </v-chip>
        </div>
        <div class="text-caption text-medium-emphasis">
          {{ routesInPlan ? t("$vuetify.title.profile.multiPathWarning") : t("$vuetify.title.profile.multiPathPremium") }}
        </div>
      </div>
      <v-btn
        v-if="!routesInPlan"
        size="small"
        variant="tonal"
        color="amber"
        prepend-icon="mdi-cart-outline"
        class="text-none flex-none"
        @click="plan.openUpgrade({ option: 'routes', value: 2 })"
      >
        {{ t("$vuetify.title.multiInternetHint.viewPlans") }}
      </v-btn>
      <v-btn
        v-if="dismissable"
        icon="mdi-close"
        size="small"
        variant="text"
        density="comfortable"
        class="flex-none"
        :aria-label="t('$vuetify.title.multiInternetHint.dismiss')"
        @click="dismissHint(hintKey)"
      />
    </div>
  </v-scale-transition>
</template>

<style scoped>
/* The same dashed card as the Multi Internet hint. */
.multipath-hint {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 10px 12px 14px;
  border: thin dashed rgba(var(--v-theme-primary), 0.35);
  border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.05);
}

.multipath-hint__badge {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.15);
  color: rgb(var(--v-theme-primary));
}

.multipath-hint__text {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
