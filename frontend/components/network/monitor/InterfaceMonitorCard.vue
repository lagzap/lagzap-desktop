<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import { useLocale, useTheme } from "vuetify";
import Sparkline from "~/components/network/monitor/Sparkline.vue";
import SensitiveText from "~/components/common/SensitiveText.vue";
import { qualityColor } from "~/composables/useNetworkMonitor";
import { useHumanSpeed } from "~/composables/helper";
import type { NetworkInterfaceMonitor } from "~/bindings/github.com/lagzap/lagzap/adapter";

/** One internet connection. Pure rendering of the Go snapshot. scale: the
 * chart ceilings every connection's card shares, so they compare at a
 * glance. */
const props = defineProps<{
  iface: NetworkInterfaceMonitor;
  color: string;
  single?: boolean;
  scale?: { ping: number; traffic: number; gateway: number };
}>();
const emit = defineEmits<{ open: [] }>();
const { t } = useLocale();
const theme = useTheme();

const KIND_ICON: Record<string, string> = {
  ethernet: "mdi-ethernet",
  wifi: "mdi-wifi",
  cellular: "mdi-signal-cellular-3",
  ppp: "mdi-lan-connect",
};
const icon = computed(() => KIND_ICON[props.iface.kind] ?? "mdi-lan");
const ispTip = computed(() => (props.iface.asn ? `${props.iface.isp} · AS${props.iface.asn}` : props.iface.isp));
const ping = computed(() => props.iface.ping);
const stats = computed(() => ping.value.stats);
const down = computed(() => ping.value.quality === "down");
const statusLabel = computed(() => {
  switch (props.iface.status) {
    case "no_internet":
      return t("$vuetify.networkLatency.monitor.statusNoInternet");
    case "warming":
      return t("$vuetify.networkLatency.monitor.statusWarming");
    default:
      return t("$vuetify.networkLatency.monitor.statusOnline");
  }
});
const statusColor = computed(() =>
  props.iface.status === "no_internet" ? "error" : props.iface.status === "warming" ? "info" : "success"
);
const uploadColor = computed(() => (theme.current.value.dark ? "#B39DDB" : "#7E57C2"));

/** The ping to the NIC's own router: slow here means the local link (often
 * Wi-Fi) is the problem, not the internet. */
const gateway = computed(() => props.iface.gateway);
const gatewayMs = (ms: number) => (ms >= 10 ? localDigits(Math.round(ms)) : localDigits(ms.toFixed(1)));

// Hovering any of the card's small charts points all three at that moment
// (matched by time) and the big numbers show its values, with no tooltip.
const hoverAt = ref<number | null>(null);
/** Index of time at in points that end at end, step ms apart (null: outside). */
function indexAt(at: number | null, end: number, step: number, length: number) {
  if (at == null || !end || !step || !length) return null;
  const idx = Math.round((at - end) / step) + length - 1;
  return idx >= 0 && idx < length ? idx : null;
}
const timeOf = (idx: number, end: number, step: number, length: number) => end - (length - 1 - idx) * step;
const pingIdx = computed(() => indexAt(hoverAt.value, ping.value.end, ping.value.step, ping.value.points?.length ?? 0));
const trafficIdx = computed(() =>
  indexAt(hoverAt.value, props.iface.traffic.end, props.iface.traffic.step, props.iface.traffic.down?.length ?? 0),
);
const gatewayIdx = computed(() => indexAt(hoverAt.value, gateway.value?.end ?? 0, 1000, gateway.value?.points?.length ?? 0));
function hoverPing(idx: number | null) {
  hoverAt.value = idx == null ? null : timeOf(idx, ping.value.end, ping.value.step, ping.value.points?.length ?? 0);
}
function hoverTraffic(idx: number | null) {
  const tr = props.iface.traffic;
  hoverAt.value = idx == null ? null : timeOf(idx, tr.end, tr.step, tr.down?.length ?? 0);
}
function hoverGateway(idx: number | null) {
  const g = gateway.value;
  hoverAt.value = idx == null || !g ? null : timeOf(idx, g.end, 1000, g.points?.length ?? 0);
}
/** The ping shown big: the hovered point's, else the latest (0: lost, -1: no data). */
const shownPing = computed(() => {
  if (hoverAt.value == null) return ping.value.now > 0 ? ping.value.now : 0;
  return pingIdx.value == null ? -1 : (ping.value.points?.[pingIdx.value] ?? -1);
});
const shownGateway = computed(() => {
  const g = gateway.value;
  if (!g) return -1;
  if (hoverAt.value == null) return g.now;
  return gatewayIdx.value == null ? -1 : (g.points?.[gatewayIdx.value] ?? -1);
});
const shownSpeed = computed(() => {
  const tr = props.iface.traffic;
  if (hoverAt.value == null) return { down: tr.download || 0, up: tr.upload || 0 };
  const i = trafficIdx.value;
  return i == null ? null : { down: Math.max(0, tr.down?.[i] ?? 0), up: Math.max(0, tr.up?.[i] ?? 0) };
});
const hoverTime = computed(() => (hoverAt.value == null ? "" : formatTimeOfDay(new Date(hoverAt.value))));
</script>

<template>
  <v-card class="iface-card" rounded="lg" variant="flat" link @click="emit('open')">
    <div class="iface-card__accent" :style="{ background: color }" />
    <v-card-text class="pa-4">
      <div class="d-flex align-center ga-2 mb-3">
        <v-icon :icon="icon" :color="color" size="20" />
        <span class="text-subtitle-1 font-weight-medium text-truncate flex-shrink-0 iface-card__name">{{ iface.name }}</span>
        <span v-if="iface.isp" class="text-caption text-medium-emphasis text-truncate" v-tooltip="ispTip">{{ iface.isp }}</span>
        <v-chip v-if="iface.default && !single" size="x-small" variant="tonal">
          {{ t("$vuetify.networkLatency.monitor.default") }}
        </v-chip>
        <v-chip :color="statusColor" size="x-small" variant="tonal">
          {{ statusLabel }}
        </v-chip>
        <v-spacer />
        <v-progress-circular
          :model-value="ping.score"
          :color="qualityColor(ping.quality)"
          size="38"
          width="3"
        >
          <span class="text-caption font-weight-bold">{{ down ? "–" : localDigits(ping.score) }}</span>
        </v-progress-circular>
        <v-icon icon="mdi-chevron-right" size="20" class="text-medium-emphasis iface-card__open" />
      </div>

      <div class="d-flex flex-wrap align-end ga-4 mb-1">
        <div class="iface-card__ping">
          <span class="lz-num"><span
            class="text-h4 font-weight-bold"
            :class="`text-${qualityColor(ping.quality)}`"
          >{{ shownPing > 0 ? localDigits(shownPing) : "—" }}</span>
          <span class="text-caption text-medium-emphasis ms-1">
            {{ shownPing > 0 || shownPing < 0 ? msUnit() : t("$vuetify.networkLatency.monitor.timeout") }}
          </span></span>
          <div class="text-caption text-medium-emphasis text-no-wrap lz-num">
            {{ hoverTime || t("$vuetify.networkLatency.monitor.internetPing") }}
          </div>
        </div>
        <div class="iface-card__stats text-caption">
          <div><span>{{ t("$vuetify.networkLatency.monitor.min") }}</span><b class="lz-num">{{ stats.min ? localDigits(stats.min) : "—" }}</b></div>
          <div><span>{{ t("$vuetify.networkLatency.monitor.avg") }}</span><b class="lz-num">{{ stats.avg ? localDigits(Math.round(stats.avg)) : "—" }}</b></div>
          <div><span>{{ t("$vuetify.networkLatency.monitor.max") }}</span><b class="lz-num">{{ stats.max ? localDigits(stats.max) : "—" }}</b></div>
          <div><span>{{ t("$vuetify.networkLatency.jitter") }}</span><b class="lz-num">{{ localDigits(stats.jitter.toFixed(1)) }}</b></div>
          <div>
            <span>{{ t("$vuetify.networkLatency.loss") }}</span>
            <b class="lz-num" :class="stats.loss > 1 ? 'text-error' : ''">{{ localDigits(`${stats.loss.toFixed(1)}%`) }}</b>
          </div>
        </div>
      </div>

      <Sparkline
        class="mb-3"
        :series="[{ points: ping.points ?? [], color, fill: true }]"
        :y-max="scale?.ping || ping.y_max"
        :height="48"
        :cursor="pingIdx"
        mark-lost
        @hover="hoverPing"
      />

      <div v-if="gateway?.address" class="iface-card__gateway mb-3" @click.stop>
        <div class="d-flex align-center ga-2 text-body-2">
          <v-icon icon="mdi-router-wireless" size="16" class="text-medium-emphasis" />
          <span class="text-medium-emphasis" v-tooltip:top="t('$vuetify.networkLatency.monitor.gatewayHint')">
            {{ t("$vuetify.networkLatency.monitor.gatewayPing") }}
          </span>
          <SensitiveText :text="gateway.address" class="text-caption text-medium-emphasis" />
          <v-spacer />
          <span class="lz-num font-weight-medium" :class="gateway.quality ? `text-${qualityColor(gateway.quality)}` : ''">
            {{ shownGateway > 0 ? `${gatewayMs(shownGateway)} ${msUnit()}` : shownGateway === 0 && hoverAt != null ? t("$vuetify.networkLatency.monitor.timeout") : "—" }}
          </span>
          <span class="text-caption text-medium-emphasis lz-num">
            {{ t("$vuetify.networkLatency.monitor.avg") }} {{ gateway.avg ? gatewayMs(gateway.avg) : "—" }}
            · {{ t("$vuetify.networkLatency.monitor.max") }} {{ gateway.max ? gatewayMs(gateway.max) : "—" }}
            · <span :class="gateway.loss > 1 ? 'text-error' : ''">{{ localDigits(`${gateway.loss.toFixed(0)}%`) }}</span>
          </span>
        </div>
        <Sparkline
          :series="[{ points: gateway.points ?? [], color }]"
          :y-max="scale?.gateway || 10"
          :height="20"
          :cursor="gatewayIdx"
          mark-lost
          @hover="hoverGateway"
        />
      </div>

      <div class="d-flex align-center ga-4 mb-1 text-body-2">
        <span class="d-flex align-center ga-1">
          <v-icon icon="mdi-arrow-down" size="16" :color="color" />
          {{ shownSpeed ? useHumanSpeed(shownSpeed.down) : "—" }}
        </span>
        <span class="d-flex align-center ga-1">
          <v-icon icon="mdi-arrow-up" size="16" :color="uploadColor" />
          {{ shownSpeed ? useHumanSpeed(shownSpeed.up) : "—" }}
        </span>
        <v-spacer />
        <span v-if="iface.game_legs > 0" class="text-caption text-medium-emphasis d-flex align-center ga-1">
          <v-icon icon="mdi-transit-connection-variant" size="14" />
          {{ t("$vuetify.networkLatency.monitor.gameRoutes", localDigits(iface.game_legs)) }}
        </span>
      </div>
      <Sparkline
        class="mb-4"
        :series="[
          { points: iface.traffic.down ?? [], color, fill: true },
          { points: iface.traffic.up ?? [], color: uploadColor },
        ]"
        :y-max="scale?.traffic || iface.traffic.y_max"
        :height="28"
        :cursor="trafficIdx"
        @hover="hoverTraffic"
      />

      <div class="text-caption text-medium-emphasis mb-1">
        {{ t("$vuetify.networkLatency.monitor.fastestServers") }}
      </div>
      <div v-if="iface.servers?.length" class="iface-card__servers">
        <div v-for="srv in iface.servers" :key="srv.node_id" class="iface-card__server">
          <CountryFlag v-if="srv.country" :country="srv.country" size="small" class="flex-shrink-0" />
          <span class="text-body-2 text-truncate">{{ srv.city || srv.name }}</span>
          <v-chip v-if="srv.live" size="x-small" color="primary" variant="tonal" class="flex-shrink-0">
            {{ t("$vuetify.networkLatency.monitor.inUse") }}
          </v-chip>
          <v-spacer />
          <span class="text-caption text-medium-emphasis text-uppercase flex-shrink-0">{{ srv.network }}</span>
          <span class="text-body-2 font-weight-medium flex-shrink-0" :class="`text-${qualityColor(srv.quality)}`">
            {{ formatMs(srv.latency) }}
          </span>
        </div>
      </div>
      <div v-else class="text-caption text-medium-emphasis">
        {{ t("$vuetify.networkLatency.monitor.noServers") }}
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
/* The name keeps its room; the ISP after it truncates first. */
.iface-card__name {
  max-width: 60%;
}

.iface-card {
  position: relative;
  overflow: hidden;
  container-type: inline-size;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}

.iface-card:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.16);
}

.iface-card__open {
  margin-inline-end: -6px;
}

.v-locale--is-rtl .iface-card__open {
  transform: scaleX(-1);
}

.iface-card__accent {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
}

.iface-card__ping {
  min-width: 96px;
  font-variant-numeric: tabular-nums;
}

.iface-card__stats {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px 12px;
  flex: 1 1 220px;
  font-variant-numeric: tabular-nums;
}

.iface-card__stats div {
  display: flex;
  flex-direction: column;
}

.iface-card__stats span {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.iface-card__servers {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.iface-card__server {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-variant-numeric: tabular-nums;
}

@container (max-width: 360px) {
  .iface-card__stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
