<script setup lang="ts">
import { useLocale } from "vuetify";
import Sparkline from "~/components/network/monitor/Sparkline.vue";
import { qualityColor } from "~/composables/useNetworkMonitor";
import { MAX_ROUTES } from "~/composables/routeCountUtils";
import PlanLock from "~/components/plan/PlanLock.vue";
import HelpTip from "~/components/settings/HelpTip.vue";
import type { NetworkInterfaceMonitor } from "~/bindings/github.com/lagzap/lagzap/adapter";

/** One adapter on the Multi Internet page: its internet ping, a small chart
 * and the three roles it can take. Pings come from the Monitoring snapshot. */
const props = defineProps<{
  name: string;
  monitor?: NetworkInterfaceMonitor;
  color: string;
  isDefault: boolean;
  /** The default was picked here, not by the operating system. */
  defaultPinned: boolean;
  inMulti: boolean;
  canLeaveMulti: boolean;
  inBackup: boolean;
  canLeaveBackup: boolean;
  /** Load balance: High traffic profiles (updates, downloads) spread their
   * connections over these. */
  inLoadBalance: boolean;
  canLeaveLoadBalance: boolean;
  /** Metered (mobile data, capped plan): load balancing never uses it. */
  metered?: boolean;
  /** Route counts over this adapter; null when it is not in Multi Internet.
   * tcp/udp are this adapter's own values, null = the page default. */
  routes?: { tcp: number | null; udp: number | null; tcpDefault: number; udpDefault: number } | null;
  /** Outside the plan: it cannot join Multi Internet or backups. */
  planLocked?: boolean;
  /** How many internets a plan must combine to unlock this one. */
  unlockInternets?: number;
  /** The plan's route limit for the inputs. */
  routeMax?: number;
}>();
const emit = defineEmits<{
  setDefault: [on: boolean];
  setMulti: [on: boolean];
  setBackup: [on: boolean];
  setLoadBalance: [on: boolean];
  setMetered: [on: boolean];
  setTcp: [value: number | null];
  setUdp: [value: number | null];
}>();
const { t } = useLocale();

// More settings (route counts, traffic limit) fold behind the round chevron
// at the card's bottom.
const expanded = ref(false);

const KIND_ICON: Record<string, string> = {
  ethernet: "mdi-ethernet",
  wifi: "mdi-wifi",
  cellular: "mdi-signal-cellular-3",
  ppp: "mdi-lan-connect",
};
const icon = computed(() => KIND_ICON[props.monitor?.kind ?? ""] ?? "mdi-lan");
const ping = computed(() => props.monitor?.ping);
const offline = computed(() => props.monitor?.status === "no_internet");
const ispTip = computed(() => {
  const m = props.monitor;
  return m?.isp ? (m.asn ? `${m.isp} · AS${m.asn}` : m.isp) : "";
});

const roles = computed(() => [
  {
    key: "default",
    icon: "mdi-star",
    label: t("$vuetify.settings.multiInternetPage.default"),
    on: props.isDefault,
    // Clicking the operating system's own pick does nothing.
    locked: props.isDefault && !props.defaultPinned,
    tip: props.isDefault
      ? props.defaultPinned
        ? t("$vuetify.settings.multiInternetPage.defaultResetTip")
        : t("$vuetify.settings.multiInternetPage.defaultSystemTip")
      : t("$vuetify.settings.multiInternetPage.defaultTip"),
    set: (on: boolean) => emit("setDefault", on),
  },
  {
    key: "multi",
    icon: "mdi-call-split",
    label: t("$vuetify.settings.multiInternetPage.multi"),
    on: props.inMulti,
    locked: (props.inMulti && !props.canLeaveMulti) || (props.planLocked && !props.inMulti),
    tip: props.planLocked && !props.inMulti
      ? t("$vuetify.plan.lockedTip")
      : props.inMulti && !props.canLeaveMulti
        ? t("$vuetify.settings.multiInternetPage.lastTip")
        : t("$vuetify.settings.multiInternetPage.multiTip"),
    set: (on: boolean) => emit("setMulti", on),
  },
  {
    key: "backup",
    icon: "mdi-shield-check-outline",
    label: t("$vuetify.settings.multiInternetPage.backup"),
    on: props.inBackup,
    locked: (props.inBackup && !props.canLeaveBackup) || (props.planLocked && !props.inBackup),
    tip: props.planLocked && !props.inBackup
      ? t("$vuetify.plan.lockedTip")
      : props.inBackup && !props.canLeaveBackup
        ? t("$vuetify.settings.multiInternetPage.lastTip")
        : t("$vuetify.settings.multiInternetPage.backupTip"),
    set: (on: boolean) => emit("setBackup", on),
  },
  {
    key: "loadBalance",
    icon: "mdi-scale-balance",
    label: t("$vuetify.settings.multiInternetPage.loadBalance"),
    on: props.inLoadBalance && !props.metered,
    locked: !!props.metered || (props.inLoadBalance && !props.canLeaveLoadBalance) || (props.planLocked && !props.inLoadBalance),
    tip: props.metered
      ? t("$vuetify.settings.multiInternetPage.meteredLoadBalanceTip")
      : props.planLocked && !props.inLoadBalance
      ? t("$vuetify.plan.lockedTip")
      : props.inLoadBalance && !props.canLeaveLoadBalance
        ? t("$vuetify.settings.multiInternetPage.lastTip")
        : t("$vuetify.settings.multiInternetPage.loadBalanceTip"),
    set: (on: boolean) => emit("setLoadBalance", on),
  },
]);
</script>

<template>
  <div class="adapter-card-wrap">
  <v-card class="adapter-card" rounded="lg" variant="flat">
    <div class="adapter-card__accent" :style="{ background: color }" />
    <v-card-text class="adapter-card__body pa-4">
      <div class="d-flex align-center ga-2 mb-2">
        <v-icon :icon="icon" :color="color" size="20" />
        <span class="text-subtitle-1 font-weight-medium text-truncate flex-shrink-0 adapter-card__name">{{ name }}</span>
        <span v-if="monitor?.isp" class="text-caption text-medium-emphasis text-truncate" :title="ispTip">{{ monitor.isp }}</span>
        <v-chip v-if="metered" color="warning" size="x-small" variant="tonal" prepend-icon="mdi-cash-clock">
          {{ t("$vuetify.settings.multiInternetPage.metered") }}
        </v-chip>
        <v-chip v-if="offline" color="error" size="x-small" variant="tonal">
          {{ t("$vuetify.networkLatency.monitor.statusNoInternet") }}
        </v-chip>
        <v-spacer />
        <PlanLock v-if="planLocked" :need="unlockInternets ? { option: 'max_internets', value: unlockInternets } : undefined" />
        <span
          class="adapter-card__ping text-h6 font-weight-bold"
          :class="ping && ping.now > 0 ? `text-${qualityColor(ping.quality)}` : 'text-medium-emphasis'"
        >
          {{ ping && ping.now > 0 ? localDigits(ping.now) : "—" }}<small class="text-caption text-medium-emphasis ms-1">{{ msUnit() }}</small>
        </span>
      </div>

      <Sparkline
        v-if="ping?.points?.length"
        :series="[{ points: ping.points, color, fill: true }]"
        :y-max="ping.y_max"
        :height="40"
        mark-lost
      />
      <div v-else class="adapter-card__empty text-caption text-medium-emphasis">
        {{ t("$vuetify.settings.multiInternetPage.noPing") }}
      </div>

      <div class="adapter-card__roles mt-3">
        <v-tooltip v-for="role in roles" :key="role.key" location="bottom" max-width="280" open-delay="300">
          <template #activator="{ props: tip }">
            <v-chip
              v-bind="tip"
              :prepend-icon="role.icon"
              :color="role.on ? 'primary' : undefined"
              :class="{ 'adapter-card__role--off': !role.on, 'adapter-card__role--locked': role.locked }"
              variant="tonal"
              size="small"
              rounded="pill"
              @click="!role.locked && role.set(!role.on)"
            >
              {{ role.label }}
              <template #append>
                <!-- The slot keeps its width when off, so a chip is the same
                     size either way and every card wraps its chips alike. -->
                <span class="adapter-card__check">
                  <v-icon v-if="role.on" icon="mdi-check" size="15" />
                </span>
              </template>
            </v-chip>
          </template>
          {{ role.tip }}
        </v-tooltip>
      </div>

      <v-expand-transition>
        <div v-if="expanded" class="adapter-card__more">
        <div v-if="routes" class="adapter-card__routes">
          <v-number-input
            :model-value="routes.tcp"
            :label="t('$vuetify.settings.multiInternetPage.tcp')"
            :placeholder="String(routes.tcpDefault)"
            :min="0"
            :max="routeMax ?? MAX_ROUTES"
            persistent-placeholder
            control-variant="split"
            variant="outlined"
            density="compact"
            hide-details
            clearable
            inset
            @update:model-value="emit('setTcp', $event)"
          />
          <v-number-input
            :model-value="routes.udp"
            :label="t('$vuetify.settings.multiInternetPage.udp')"
            :placeholder="String(routes.udpDefault)"
            :min="0"
            :max="routeMax ?? MAX_ROUTES"
            persistent-placeholder
            control-variant="split"
            variant="outlined"
            density="compact"
            hide-details
            clearable
            inset
            @update:model-value="emit('setUdp', $event)"
          />
        </div>
        <v-checkbox
          :model-value="!!metered"
          density="compact"
          hide-details
          class="mt-3"
          @update:model-value="emit('setMetered', !!$event)"
        >
          <template #label>
            <span class="text-body-2">{{ t("$vuetify.settings.multiInternetPage.markMetered") }}</span>
            <HelpTip class="ms-1" :text="t('$vuetify.settings.multiInternetPage.meteredHint')" />
          </template>
        </v-checkbox>
        <!-- Traffic limit: its own page comes later; shown, not usable yet. -->
        <v-text-field
          :label="t('$vuetify.settings.multiInternetPage.trafficLimit')"
          :placeholder="t('$vuetify.settings.multiInternetPage.trafficLimitSoon')"
          persistent-placeholder
          prepend-inner-icon="mdi-gauge"
          variant="outlined"
          density="compact"
          hide-details
          disabled
          class="mt-3"
        />
        </div>
      </v-expand-transition>
    </v-card-text>
  </v-card>
  <!-- On the bottom border, styled like the drag grip on the top one. -->
  <button
    type="button"
    class="adapter-card__toggle"
    :aria-expanded="expanded"
    :title="expanded ? t('$vuetify.settings.multiInternetPage.lessSettings') : t('$vuetify.settings.multiInternetPage.moreSettings')"
    @click="expanded = !expanded"
  >
    <v-icon size="16" class="adapter-card__chevron" :class="{ 'adapter-card__chevron--up': expanded }">mdi-chevron-down</v-icon>
  </button>
  </div>
</template>

<style scoped>
/* The name keeps its room; the ISP after it truncates first. */
.adapter-card__name {
  max-width: 60%;
}

.adapter-card {
  position: relative;
  overflow: hidden;
  height: 100%;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}

/* Route inputs sit at the bottom (margin-top: auto), level across cards
 * whose chips wrap differently. */
.adapter-card__body {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.adapter-card__accent {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
}

.adapter-card__ping {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.adapter-card__empty {
  height: 40px;
  display: flex;
  align-items: center;
}

.adapter-card__roles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.adapter-card__role--off {
  opacity: 0.6;
}

.adapter-card__role--locked {
  cursor: default;
}

/* One input per row unless the card fits both at a width where the value
 * still shows between the -/+ buttons and the clear button. */
.adapter-card__routes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  align-items: center;
  /* Stacked, UDP gets 0.5rem more room under TCP; side by side is unchanged. */
  gap: calc(8px + 0.5rem) 8px;
  padding-top: 20px;
}

/* Folded settings sit at the bottom, level across cards. */
.adapter-card__more {
  margin-top: auto;
}

.adapter-card-wrap {
  position: relative;
  height: 100%;
}

/* Same look as the drag grip (multi-internet.vue .adapter-slot__grip), on
 * the bottom border. */
.adapter-card__toggle {
  position: absolute;
  bottom: -10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.adapter-card-wrap:hover .adapter-card__toggle,
.adapter-card__toggle:focus-visible {
  color: rgb(var(--v-theme-primary));
  border-color: rgba(var(--v-theme-primary), 0.5);
}

.adapter-card__chevron {
  transition: transform 200ms ease;
}

.adapter-card__chevron--up {
  transform: rotate(180deg);
}

/* The check slides in on the right and pops once when a role turns on. */
.adapter-card__check {
  display: inline-flex;
  width: 19px;
  padding-inline-start: 4px;
}

.adapter-card__check .v-icon {
  animation: role-check-pop 260ms cubic-bezier(0.3, 1.4, 0.6, 1) both;
}

@keyframes role-check-pop {
  from {
    opacity: 0;
    transform: scale(0.3) rotate(-30deg);
  }
  to {
    opacity: 1;
    transform: scale(1) rotate(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .adapter-card__check .v-icon {
    animation: none;
  }
}
</style>
