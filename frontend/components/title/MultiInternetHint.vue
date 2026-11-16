<script setup lang="ts">
import { useLocale } from "vuetify";
import { useNetworkAdapterSettings } from "~/composables/useNetworkAdapterSettings";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { openInternetsMenu } from "~/composables/useInternetsMenu";

/** Another internet (a phone, a second modem) helps this profile:
 *  - download (High traffic: downloads, updates): load balancing spreads
 *    them over both, faster;
 *  - game (game packets over Multi Internet): every packet goes over both,
 *    so one internet's spike or drop does not reach the game.
 * Full while the profile is idle, one line while it runs; gone once
 * dismissed or once the profile already uses several internets. */
const props = defineProps<{ profileId: string; kind: "download" | "game"; compact?: boolean }>();

const { t } = useLocale();
const store = useStore();
const { loadBalance, multiInternet, isMetered } = useNetworkAdapterSettings();
const text = (key: string) => t(`$vuetify.title.multiInternetHint.${props.kind}.${key}`);
const common = (key: string) => t(`$vuetify.title.multiInternetHint.${key}`);

// Load balancing downloads is free. Multi Internet for games is premium:
// the plan must let two internets work together (max_internets 0 is no
// cap); without it the hint offers the plans that have it.
const plan = usePlanAccess();
const inPlan = computed(() => {
  if (props.kind === "download" || plan.admin.value) return true;
  if (!plan.active.value) return false;
  const max = plan.limits.value?.max_internets ?? 0;
  return max === 0 || max >= 2;
});
const chip = computed(() =>
  props.kind === "download" ? common("free") : inPlan.value ? common("included") : common("premium"),
);
// Games: the chip already says In your plan or Premium.
const tail = computed(() => (props.kind === "download" ? text("tail") : ""));
// Downloads: the Load balance icon; games: adding another internet.
const icon = computed(() => (props.kind === "download" ? "mdi-scale-balance" : "mdi-plus-network-outline"));
const actionLabel = computed(() => (inPlan.value ? common("action") : common("viewPlans")));

// network_interfaces, download: empty or "*" = the Load balance internets
// from the Multi Internet page, "-" = off, names = the profile's own.
// Game: empty = the Multi Internet page's, names = the profile's own.
const balanced = computed(() => {
  const own = (store.profileStates[props.profileId]?.network_interfaces ?? []).filter(Boolean);
  if (props.kind === "game") {
    return own.length > 0 ? own.length > 1 : multiInternet.selection.value.length > 1;
  }
  if (own.includes("-")) return false;
  const picked = own.filter((name) => name !== "*");
  if (picked.length > 0) return picked.length > 1;
  const present = new Set((store.interfaces ?? []).map((iface) => iface.Name));
  return loadBalance.selection.value.filter((name) => present.has(name) && !isMetered(name)).length > 1;
});

// Closed for good, per kind; Settings turns tips off or brings them back.
const { hintShown, dismissHint } = useSettings();
const hintKey = computed(() => `multiInternet.${props.kind}`);
const dismissed = computed(() => !hintShown(hintKey.value));
function dismiss() {
  void dismissHint(hintKey.value);
}
function setUp() {
  if (inPlan.value) {
    openInternetsMenu(props.profileId);
  } else {
    plan.openUpgrade({ option: "max_internets", value: 2 });
  }
}
</script>

<template>
  <v-expand-transition>
    <div v-if="!balanced && !dismissed" class="lb-hint-wrap">
      <div v-if="compact" class="lb-hint lb-hint--compact">
        <v-icon :icon="icon" size="16" class="lb-hint__icon" />
        <span class="lb-hint__line text-truncate">{{ text("short") }}</span>
        <v-btn size="x-small" variant="text" color="primary" class="text-none" @click="setUp">
          {{ actionLabel }}
        </v-btn>
        <v-btn
          icon="mdi-close"
          size="x-small"
          variant="text"
          density="comfortable"
          :aria-label="t('$vuetify.title.multiInternetHint.dismiss')"
          @click="dismiss"
        />
      </div>
      <div v-else class="lb-hint">
        <div class="lb-hint__badge">
          <v-icon :icon="icon" size="22" />
        </div>
        <div class="lb-hint__text">
          <div class="d-flex align-center flex-wrap ga-2">
            <span class="text-body-2 font-weight-medium">{{ text("title") }}</span>
            <v-chip size="x-small" variant="tonal" :color="inPlan ? 'primary' : 'amber'">
              {{ chip }}
            </v-chip>
          </div>
          <div class="text-caption text-medium-emphasis">{{ text("body") }} {{ tail }}</div>
        </div>
        <div class="lb-hint__actions">
          <v-btn
            size="small"
            variant="tonal"
            :color="inPlan ? 'primary' : 'amber'"
            :prepend-icon="inPlan ? undefined : 'mdi-cart-outline'"
            class="text-none"
            @click="setUp"
          >
            {{ actionLabel }}
          </v-btn>
          <v-btn
            icon="mdi-close"
            size="small"
            variant="text"
            density="comfortable"
            :aria-label="t('$vuetify.title.multiInternetHint.dismiss')"
            @click="dismiss"
          />
        </div>
      </div>
    </div>
  </v-expand-transition>
</template>

<style scoped>
.lb-hint-wrap {
  padding: 0 16px 12px;
}

.lb-hint {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 8px 12px 14px;
  border: thin dashed rgba(var(--v-theme-primary), 0.35);
  border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.05);
}

.lb-hint--compact {
  gap: 8px;
  padding: 4px 4px 4px 12px;
  border-style: solid;
  border-color: rgba(var(--v-theme-on-surface), 0.1);
  background: transparent;
}

.lb-hint__badge {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.15);
  color: rgb(var(--v-theme-primary));
}

.lb-hint__icon {
  flex: none;
  color: rgb(var(--v-theme-primary));
}

.lb-hint__text {
  flex: 1 1 auto;
  min-width: 0;
}

.lb-hint__line {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.lb-hint__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
}
</style>
