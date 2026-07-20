<script setup lang="ts">
import { useLocale } from "vuetify";

/**
 * Overview controls: routing switch · plan · account.
 * Plan fields stubbed until subscription API exists.
 */
const { displayName, planName, planStatus, planStatusLabel, user } =
  useAccountStatus();
const { t } = useLocale();
const store = useStore();

const routingOn = computed(() => store.ndisRunning);
const avatarLetter = computed(() => {
  const raw = user.value?.name || user.value?.email || "";
  return raw.length ? raw[0].toUpperCase() : "";
});
</script>

<template>
  <div class="account-strip">
    <div class="account-strip__routing">
      <v-switch
        :model-value="routingOn"
        inset
        hide-details
        density="comfortable"
        :color="store.error ? 'red' : 'green'"
        :disabled="!store.serviceReady"
        :loading="store.loading"
        class="account-strip__switch"
        @click.stop.prevent="store.toggleNDIS()"
      />
      <span class="account-strip__label">
        {{ t("$vuetify.accountStatus.serviceStatus") }}
      </span>
    </div>

    <div class="account-strip__end">
      <div class="account-strip__meta">
        <span class="account-strip__plan">{{ planName }}</span>
        <span
          class="account-strip__badge"
          :class="`account-strip__badge--${planStatus}`"
        >
          {{ planStatusLabel }}
        </span>
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
  </div>
</template>

<style scoped>
.account-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  width: 100%;
  min-width: 0;
}

.account-strip__routing {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.account-strip__label {
  font-size: 0.875rem;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface));
  white-space: nowrap;
}

.account-strip__switch {
  flex: 0 0 auto;
  margin: 0;
  padding-top: 0;
}

.account-strip__switch :deep(.v-selection-control) {
  min-height: 28px;
}

.account-strip__switch :deep(.v-switch__track) {
  opacity: 1;
}

.account-strip__switch :deep(.v-switch__thumb) {
  color: #e8e6d9 !important;
  background-color: #e8e6d9 !important;
}

.account-strip__switch :deep(.v-selection-control--dirty .v-switch__track) {
  background-color: #3d6b3d !important;
  opacity: 1;
}

.account-strip__end {
  display: flex;
  align-items: center;
  gap: 16px;
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
.account-strip__badge--trial {
  background: rgba(230, 215, 133, 0.14);
  color: #e6d785;
}

.account-strip__badge--expiring {
  background: rgba(251, 140, 0, 0.16);
  color: #ffa726;
}

.account-strip__badge--expired {
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
</style>
