<script setup lang="ts">
import { computed } from "vue";
import { useLocale } from "vuetify";
import { ROUTE_LEVELS, useRouteLevel } from "~/composables/useRouteLevel";
import { useRouteLevels } from "~/composables/useRouteLevels";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { localDigits } from "~/utils/localeFormat";

/** The plan's route level as three steps (Basic, Advanced, Ultimate), what
 * each does, and how much faster a higher level measured on this user's
 * games. */
const { t } = useLocale();
const { levelName, levelHint } = useRouteLevel();
const { levels } = useRouteLevels();
const plan = usePlanAccess();

const planLevel = computed(() => levels.value?.plan ?? 0);
const upgradeLevel = computed(() => levels.value?.upgrade_level ?? 0);
const upgradeMs = computed(() => levels.value?.upgrade_ms ?? 0);
const nextLevel = computed(() => (levels.value && planLevel.value < 3 ? planLevel.value + 1 : 0));
</script>

<template>
  <div v-if="levels" class="route-level">
    <div class="d-flex align-center ga-2">
      <span class="lz-label">{{ t("$vuetify.routeLevel.title") }}</span>
      <v-spacer />
      <span class="text-body-2 font-weight-medium">{{ levelName(planLevel) }}</span>
    </div>

    <div class="route-level__steps">
      <div
        v-for="level in ROUTE_LEVELS"
        :key="level"
        class="route-level__step"
        :class="{ 'route-level__step--on': level <= planLevel, 'route-level__step--next': level === nextLevel }"
      >
        <div class="route-level__bar" />
        <span class="route-level__name">{{ levelName(level) }}</span>
      </div>
    </div>

    <div class="text-caption text-medium-emphasis">{{ levelHint(planLevel) }}</div>

    <div v-if="upgradeLevel && upgradeMs > 0" class="route-level__upgrade">
      <v-icon icon="mdi-rocket-launch-outline" size="18" color="amber" />
      <span class="text-body-2">
        {{ t("$vuetify.routeLevel.upgradeSummary", levelName(upgradeLevel), localDigits(upgradeMs)) }}
      </span>
      <v-spacer />
      <v-btn
        v-if="plan.canUpgrade.value"
        size="small"
        variant="tonal"
        color="amber"
        class="text-none"
        prepend-icon="mdi-cart-outline"
        @click="plan.openUpgrade({ option: 'max_hops', value: upgradeLevel })"
      >
        {{ t("$vuetify.plan.unlock") }}
      </v-btn>
    </div>
    <div v-else-if="nextLevel" class="text-caption text-medium-emphasis">
      {{ t("$vuetify.routeLevel.nextHint", levelName(nextLevel), levelHint(nextLevel)) }}
    </div>
  </div>
</template>

<style scoped>
.route-level {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.route-level__steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.route-level__step {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.route-level__bar {
  height: 6px;
  border-radius: 3px;
  background: rgba(var(--v-theme-on-surface), 0.12);
}

.route-level__step--on .route-level__bar {
  background: rgb(var(--v-theme-primary));
}

.route-level__step--next .route-level__bar {
  background: rgba(255, 193, 7, 0.35);
}

.route-level__name {
  font-size: 0.7rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  text-align: center;
}

.route-level__step--on .route-level__name {
  color: rgb(var(--v-theme-on-surface));
}

.route-level__upgrade {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 193, 7, 0.08);
}
</style>
