<script setup lang="ts">
import { computed } from "vue";
import { useLocale } from "vuetify";
import { PLAN_STATUS_COLOR, useAccountPlan } from "~/composables/useAccountPlan";
import { localDigits } from "~/utils/localeFormat";
import RouteLevelMeter from "~/components/plan/RouteLevelMeter.vue";
import TeamPlanBadge from "~/components/team/TeamPlanBadge.vue";

/** The subscription: plan, status, when it ends, and what it includes. */
const { t } = useLocale();
const plan = useAccountPlan();

const statusColor = computed(() => PLAN_STATUS_COLOR[plan.status.value] ?? "grey");
const endingSoon = computed(() => plan.daysLeft.value != null && plan.daysLeft.value <= 7);
const limit = (n: number | undefined) => (n && n > 0 ? localDigits(n) : t("$vuetify.profile.unlimited"));
const upgradeLabel = computed(() =>
  plan.active.value && plan.status.value !== "trial" ? t("$vuetify.profile.managePlan") : t("$vuetify.profile.upgrade"),
);
</script>

<template>
  <section class="lz-panel subscription">
    <div class="lz-panel__head">
      <v-icon icon="mdi-card-account-details-star-outline" size="20" color="primary" />
      <span class="text-subtitle-1 font-weight-medium">{{ t("$vuetify.profile.subscription") }}</span>
      <v-spacer />
      <TeamPlanBadge />
      <v-chip v-if="plan.status.value" size="small" variant="tonal" rounded="pill" :color="statusColor">
        {{ t(`$vuetify.profile.status.${plan.status.value}`) }}
      </v-chip>
    </div>

    <template v-if="plan.active.value">
      <div class="subscription__plan">
        <div class="min-w-0">
          <div class="lz-label">{{ t("$vuetify.profile.plan") }}</div>
          <div class="text-h5 font-weight-bold text-truncate">{{ plan.name.value || t(`$vuetify.profile.status.${plan.status.value}`) }}</div>
        </div>
        <div v-if="plan.expiresAt.value" class="text-end">
          <div class="lz-label">{{ t("$vuetify.profile.endsOn") }}</div>
          <div class="text-body-1 font-weight-medium">{{ plan.expiresText.value }}</div>
          <div class="text-caption" :class="endingSoon ? 'text-warning' : 'text-medium-emphasis'">
            {{ t("$vuetify.profile.daysLeft", localDigits(plan.daysLeft.value ?? 0)) }}
          </div>
        </div>
      </div>

      <div class="lz-metrics">
        <div class="lz-metric">
          <span class="lz-label">{{ t("$vuetify.profile.internets") }}</span>
          <span class="lz-metric__value">{{ limit(plan.limits.value?.max_internets) }}</span>
        </div>
        <div class="lz-metric">
          <span class="lz-label">{{ t("$vuetify.profile.routes") }}</span>
          <span class="lz-metric__value">{{ limit(plan.limits.value?.max_routes) }}</span>
        </div>
      </div>
      <RouteLevelMeter />
    </template>

    <div v-else-if="plan.status.value === 'loading'" class="text-body-2 text-medium-emphasis">
      {{ t("$vuetify.profile.planPending") }}
    </div>
    <div v-else class="text-body-2">{{ t(`$vuetify.profile.inactive.${plan.status.value}`) }}</div>

    <div class="d-flex flex-wrap ga-2 mt-1">
      <v-btn
        v-if="plan.canUpgrade.value"
        variant="tonal"
        color="primary"
        rounded="lg"
        prepend-icon="mdi-rocket-launch-outline"
        @click="plan.openUpgrade"
      >
        {{ upgradeLabel }}
      </v-btn>
      <v-btn variant="tonal" rounded="lg" prepend-icon="mdi-account-group-outline" :to="{ name: 'team' }">
        {{ t("$vuetify.team.title") }}
      </v-btn>
    </div>
  </section>
</template>

<style scoped>
.subscription__plan {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}
</style>
