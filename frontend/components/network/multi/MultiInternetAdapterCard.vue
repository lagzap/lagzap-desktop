<script setup lang="ts">
import { useLocale } from "vuetify";
import Sparkline from "~/components/network/monitor/Sparkline.vue";
import { qualityColor } from "~/composables/useNetworkMonitor";
import { MAX_ROUTES } from "~/composables/routeCountUtils";
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
  /** Route counts over this adapter; null when it is not in Multi Internet.
   * tcp/udp are this adapter's own values, null = the page default. */
  routes?: { tcp: number | null; udp: number | null; tcpDefault: number; udpDefault: number } | null;
}>();
const emit = defineEmits<{
  setDefault: [on: boolean];
  setMulti: [on: boolean];
  setBackup: [on: boolean];
  setTcp: [value: number | null];
  setUdp: [value: number | null];
}>();
const { t } = useLocale();

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
    locked: props.inMulti && !props.canLeaveMulti,
    tip: props.inMulti && !props.canLeaveMulti
      ? t("$vuetify.settings.multiInternetPage.lastTip")
      : t("$vuetify.settings.multiInternetPage.multiTip"),
    set: (on: boolean) => emit("setMulti", on),
  },
  {
    key: "backup",
    icon: "mdi-shield-check-outline",
    label: t("$vuetify.settings.multiInternetPage.backup"),
    on: props.inBackup,
    locked: props.inBackup && !props.canLeaveBackup,
    tip: props.inBackup && !props.canLeaveBackup
      ? t("$vuetify.settings.multiInternetPage.lastTip")
      : t("$vuetify.settings.multiInternetPage.backupTip"),
    set: (on: boolean) => emit("setBackup", on),
  },
]);
</script>

<template>
  <v-card class="adapter-card" rounded="lg" variant="flat">
    <div class="adapter-card__accent" :style="{ background: color }" />
    <v-card-text class="adapter-card__body pa-4">
      <div class="d-flex align-center ga-2 mb-2">
        <v-icon :icon="icon" :color="color" size="20" />
        <span class="text-subtitle-1 font-weight-medium text-truncate flex-shrink-0 adapter-card__name">{{ name }}</span>
        <span v-if="monitor?.isp" class="text-caption text-medium-emphasis text-truncate" :title="ispTip">{{ monitor.isp }}</span>
        <v-chip v-if="offline" color="error" size="x-small" variant="tonal" label>
          {{ t("$vuetify.networkLatency.monitor.statusNoInternet") }}
        </v-chip>
        <v-spacer />
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
        <div v-if="routes" class="adapter-card__routes">
          <v-number-input
            :model-value="routes.tcp"
            :label="t('$vuetify.settings.multiInternetPage.tcp')"
            :placeholder="String(routes.tcpDefault)"
            :min="0"
            :max="MAX_ROUTES"
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
            :max="MAX_ROUTES"
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
      </v-expand-transition>
    </v-card-text>
  </v-card>
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
  margin-top: auto;
  padding-top: 20px;
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
