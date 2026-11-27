<script setup lang="ts">
import { useLocale } from "vuetify";
import { useRouteLevel } from "~/composables/useRouteLevel";
import { useRouteLevels } from "~/composables/useRouteLevels";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { formatMs } from "~/utils/localeFormat";

/**
 * Overview: the plan at the start, the account at the end (the main switch
 * is beside the logo, in the sidebar).
 * Plan fields stubbed until subscription API exists.
 */
const { displayName, planName, planStatus, planStatusLabel, user } =
  useAccountStatus();
const { t } = useLocale();
const { levelName, routesText } = useRouteLevel();
const { levels } = useRouteLevels();
const { canUpgrade, openUpgrade } = usePlanAccess();
const levelLabel = computed(() =>
  levels.value ? routesText(levels.value.plan) : "",
);
const upgrade = computed(() =>
  levels.value?.upgrade_level && levels.value.upgrade_ms > 0 ? levels.value : null,
);

const avatarLetter = computed(() => {
  const raw = user.value?.name || "";
  return raw.length ? raw[0].toUpperCase() : "";
});

</script>

<template>
  <div class="account-strip">
    <!-- The plan, at the start (the main switch is beside the logo). -->
    <div class="account-strip__meta">
      <NuxtLink :to="{ name: 'plans' }" class="account-strip__plan-link text-decoration-none">
        <span class="account-strip__plan">{{ planName }}</span>
        <span
          class="account-strip__badge"
          :class="`account-strip__badge--${planStatus}`"
        >
          {{ planStatusLabel }}
        </span>
      </NuxtLink>
      <span v-if="levelLabel" class="account-strip__level">{{ levelLabel }}</span>
      <v-tooltip v-if="upgrade" :text="t('$vuetify.routeLevel.upgradeOverviewTip')" location="bottom">
        <template #activator="{ props }">
          <v-chip
            v-bind="props"
            size="small"
            variant="tonal"
            color="amber"
            prepend-icon="mdi-rocket-launch-outline"
            :disabled="!canUpgrade"
            @click="openUpgrade"
          >
            {{ t("$vuetify.routeLevel.upgradeChip", levelName(upgrade.upgrade_level), formatMs(upgrade.upgrade_ms)) }}
          </v-chip>
        </template>
      </v-tooltip>
    </div>
    <NuxtLink
      :to="{ name: 'profile' }"
      class="account-strip__user text-decoration-none"
    >
      <span class="account-strip__name text-truncate">{{ displayName }}</span>
      <v-avatar
        size="28"
        :variant="avatarLetter ? 'tonal' : 'text'"
        color="primary"
      >
        <span v-if="avatarLetter" class="text-caption text-uppercase">
          {{ avatarLetter }}
        </span>
        <v-icon v-else icon="mdi-account-circle" size="22" />
      </v-avatar>
    </NuxtLink>
  </div>
</template>

<style scoped>
.account-strip__plan-link {
  display: inline-flex;
  align-items: center;
  gap: inherit;
  color: inherit;
  cursor: pointer;
  border-radius: 6px;
  transition: opacity 0.15s ease;
}

.account-strip__plan-link:hover {
  opacity: 0.8;
}

.account-strip__plan-link:hover .account-strip__plan {
  text-decoration: underline;
}

.account-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  width: 100%;
  min-width: 0;
}

.account-strip__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.account-strip__plan {
  font-size: 0.8125rem;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
  white-space: nowrap;
}

.account-strip__badge {
  font-size: 0.625rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 2px 7px;
  border-radius: 4px;
  line-height: 1.3;
  background: rgba(230, 215, 133, 0.14);
  color: #e6d785;
  white-space: nowrap;
}

.account-strip__badge--active,
.account-strip__badge--admin,
.account-strip__badge--trial {
  background: rgba(230, 215, 133, 0.14);
  color: #e6d785;
}

.account-strip__badge--expiring {
  background: rgba(251, 140, 0, 0.16);
  color: #ffa726;
}

.account-strip__badge--expired,
.account-strip__badge--none,
.account-strip__badge--unavailable {
  background: rgba(239, 83, 80, 0.16);
  color: #ef5350;
}

.account-strip__user {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: inherit;
}

.account-strip__name {
  font-size: 0.8125rem;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface), 0.65);
  max-width: 140px;
}

.account-strip__level {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
  white-space: nowrap;
}
</style>
