<script setup lang="ts">
import { useLocale } from "vuetify";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import { ProfileFlag } from "~/constants/profile";
import { useNetworkMonitor } from "~/composables/useNetworkMonitor";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { useProfileMultipath } from "~/composables/useProfileMultipath";
import { formatMs } from "~/utils/localeFormat";

/** A game on one internet while another one has a clearly better ping:
 * switch to it, or (Multi Internet games, when the plan has it) use both.
 * The plan decides what it offers; it shows in every case. */
const props = defineProps<{ profile: Profile }>();

const { t } = useLocale();
const store = useStore();
const plan = usePlanAccess();
const { monitor } = useNetworkMonitor();
const { adapters } = useProfileMultipath(() => props.profile);
const { hintShown, dismissHint } = useSettings();
const text = (key: string, ...params: unknown[]) => t(`$vuetify.title.betterInternetHint.${key}`, ...params);

// "Clearly" better: by 15 ms and 20% at least, over the monitor's last minute.
const BETTER_MIN_MS = 15;
const BETTER_MIN_RATIO = 0.2;

const isMulti = computed(() => (props.profile.flags & ProfileFlag.MULTIPATH) !== 0);
/** The one internet the game uses now; none when it already uses several. */
const current = computed(() => {
  if (isMulti.value) {
    if (adapters.value.length > 1) return "";
    if (adapters.value.length === 1) return adapters.value[0];
  }
  return store.profileStates[props.profile.id]?.default_interface || store.defaultInterface || "";
});
const pingOf = (name: string) => {
  const iface = monitor.value?.interfaces?.find((entry) => entry.name === name);
  if (!iface || iface.ping?.quality === "down") return 0;
  return iface.ping?.stats?.avg ?? 0;
};
const candidate = computed(() => {
  const cur = current.value;
  if (!cur) return null;
  const curMs = pingOf(cur);
  let best: { name: string; ms: number } | null = null;
  for (const iface of monitor.value?.interfaces ?? []) {
    if (iface.name === cur) continue;
    const ms = pingOf(iface.name);
    if (ms <= 0) continue;
    // A dead current internet loses to any working one.
    const clearly = curMs <= 0 || ms <= curMs - Math.max(BETTER_MIN_MS, curMs * BETTER_MIN_RATIO);
    if (clearly && (!best || ms < best.ms)) best = { name: iface.name, ms };
  }
  return best ? { ...best, current: cur, currentMs: curMs } : null;
});

// Shown once the same internet has stayed better for a few seconds, so one
// ping does not flash it. The numbers keep updating meanwhile.
const HOLD_MS = 8000;
const heldName = ref("");
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let pendingName = "";
watch(
  () => candidate.value?.name ?? "",
  (name) => {
    if (name === pendingName) return;
    pendingName = name;
    clearTimeout(holdTimer);
    heldName.value = "";
    if (name) holdTimer = setTimeout(() => (heldName.value = name), HOLD_MS);
  },
  { immediate: true },
);
onUnmounted(() => clearTimeout(holdTimer));
const better = computed(() => (heldName.value && candidate.value?.name === heldName.value ? candidate.value : null));

const hintKey = computed(() => `betterInternet.${props.profile.id}`);
const shown = computed(() => !!better.value && hintShown(hintKey.value));

/** No active plan: only the plans. Multi Internet games: both, when the
 * plan joins two internets. */
const hasPlan = computed(() => plan.admin.value || plan.active.value);
const bothInPlan = computed(() => {
  if (plan.admin.value) return true;
  const max = plan.limits.value?.max_internets ?? 0;
  return plan.active.value && (max === 0 || max >= 2);
});
const detail = computed(() => {
  if (!better.value) return "";
  if (!hasPlan.value) return text("noPlan");
  if (!isMulti.value) return text("switchOnly");
  return bothInPlan.value ? text("useBoth") : text("bothPremium");
});

function switchTo() {
  const state = store.profileStates[props.profile.id];
  if (!state || !better.value) return;
  if (isMulti.value) state.network_interfaces = [better.value.name];
  else state.default_interface = better.value.name;
}
function useBoth() {
  const state = store.profileStates[props.profile.id];
  if (!state || !better.value) return;
  state.network_interfaces = [better.value.current, better.value.name];
}
function viewPlans() {
  plan.openUpgrade(hasPlan.value ? { option: "max_internets", value: 2 } : undefined);
}
</script>

<template>
  <v-expand-transition>
    <div v-if="shown && better" class="better-hint">
      <div class="better-hint__badge">
        <v-icon icon="mdi-speedometer" size="20" />
      </div>
      <div class="better-hint__text">
        <div class="d-flex align-center flex-wrap ga-2">
          <span class="text-body-2 font-weight-medium">{{ text("title", better.name) }}</span>
          <v-chip v-if="hasPlan && isMulti && !bothInPlan" size="x-small" variant="tonal" color="amber">
            {{ t("$vuetify.title.multiInternetHint.premium") }}
          </v-chip>
        </div>
        <div class="text-caption text-medium-emphasis">
          {{ text("pings", better.name, formatMs(better.ms), better.current, formatMs(better.currentMs, text("down"))) }}
          {{ detail }}
        </div>
      </div>
      <div class="better-hint__actions">
        <template v-if="hasPlan">
          <v-btn
            v-if="isMulti && bothInPlan"
            size="small"
            variant="tonal"
            color="primary"
            class="text-none"
            @click="useBoth"
          >
            {{ text("useBothAction") }}
          </v-btn>
          <v-btn
            size="small"
            :variant="isMulti && bothInPlan ? 'text' : 'tonal'"
            color="primary"
            class="text-none"
            @click="switchTo"
          >
            {{ text("switchAction") }}
          </v-btn>
          <v-btn
            v-if="isMulti && !bothInPlan"
            size="small"
            variant="text"
            color="amber"
            prepend-icon="mdi-cart-outline"
            class="text-none"
            @click="viewPlans"
          >
            {{ t("$vuetify.title.multiInternetHint.viewPlans") }}
          </v-btn>
        </template>
        <v-btn
          v-else
          size="small"
          variant="tonal"
          color="amber"
          prepend-icon="mdi-cart-outline"
          class="text-none"
          @click="viewPlans"
        >
          {{ t("$vuetify.title.multiInternetHint.viewPlans") }}
        </v-btn>
        <v-btn
          icon="mdi-close"
          size="small"
          variant="text"
          density="comfortable"
          :aria-label="t('$vuetify.title.multiInternetHint.dismiss')"
          @click="dismissHint(hintKey)"
        />
      </div>
    </div>
  </v-expand-transition>
</template>

<style scoped>
/* The same dashed card as the other profile tips. */
.better-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 12px 8px 12px 14px;
  border: thin dashed rgba(var(--v-theme-primary), 0.35);
  border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.05);
}

.better-hint__badge {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.15);
  color: rgb(var(--v-theme-primary));
}

.better-hint__text {
  flex: 1 1 220px;
  min-width: 0;
}

.better-hint__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
  margin-inline-start: auto;
}
</style>
