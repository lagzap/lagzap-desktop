<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import { useLocale, useTheme } from "vuetify";
import Sparkline from "~/components/network/monitor/Sparkline.vue";
import { qualityColor } from "~/composables/useNetworkMonitor";
import { useHumanSpeed } from "~/composables/helper";
import type { NetworkInterfaceMonitor } from "~/bindings/github.com/lagzap/lagzap/adapter";

/** One internet connection. Pure rendering of the Go snapshot. */
const props = defineProps<{ iface: NetworkInterfaceMonitor; color: string; single?: boolean }>();
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
</script>

<template>
  <v-card class="iface-card" rounded="lg" variant="flat" link @click="emit('open')">
    <div class="iface-card__accent" :style="{ background: color }" />
    <v-card-text class="pa-4">
      <div class="d-flex align-center ga-2 mb-3">
        <v-icon :icon="icon" :color="color" size="20" />
        <span class="text-subtitle-1 font-weight-medium text-truncate flex-shrink-0 iface-card__name">{{ iface.name }}</span>
        <span v-if="iface.isp" class="text-caption text-medium-emphasis text-truncate" :title="ispTip">{{ iface.isp }}</span>
        <v-chip v-if="iface.default && !single" size="x-small" variant="tonal" label>
          {{ t("$vuetify.networkLatency.monitor.default") }}
        </v-chip>
        <v-chip :color="statusColor" size="x-small" variant="tonal" label>
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
          <span
            class="text-h4 font-weight-bold"
            :class="`text-${qualityColor(ping.quality)}`"
          >{{ ping.now > 0 ? localDigits(ping.now) : "—" }}</span>
          <span class="text-caption text-medium-emphasis ms-1">
            {{ ping.now > 0 ? msUnit() : t("$vuetify.networkLatency.monitor.timeout") }}
          </span>
          <div class="text-caption text-medium-emphasis">
            {{ t("$vuetify.networkLatency.monitor.internetPing") }}
          </div>
        </div>
        <div class="iface-card__stats text-caption">
          <div><span>{{ t("$vuetify.networkLatency.monitor.min") }}</span><b>{{ stats.min ? localDigits(stats.min) : "—" }}</b></div>
          <div><span>{{ t("$vuetify.networkLatency.monitor.avg") }}</span><b>{{ stats.avg ? localDigits(Math.round(stats.avg)) : "—" }}</b></div>
          <div><span>{{ t("$vuetify.networkLatency.monitor.max") }}</span><b>{{ stats.max ? localDigits(stats.max) : "—" }}</b></div>
          <div><span>{{ t("$vuetify.networkLatency.jitter") }}</span><b>{{ localDigits(stats.jitter.toFixed(1)) }}</b></div>
          <div>
            <span>{{ t("$vuetify.networkLatency.loss") }}</span>
            <b :class="stats.loss > 1 ? 'text-error' : ''">{{ localDigits(`${stats.loss.toFixed(1)}%`) }}</b>
          </div>
        </div>
      </div>

      <Sparkline
        class="mb-3"
        :series="[{ points: ping.points ?? [], color, fill: true }]"
        :y-max="ping.y_max"
        :height="48"
        mark-lost
      />

      <div class="d-flex align-center ga-4 mb-1 text-body-2">
        <span class="d-flex align-center ga-1">
          <v-icon icon="mdi-arrow-down" size="16" :color="color" />
          {{ useHumanSpeed(iface.traffic.download || 0) }}
        </span>
        <span class="d-flex align-center ga-1">
          <v-icon icon="mdi-arrow-up" size="16" :color="uploadColor" />
          {{ useHumanSpeed(iface.traffic.upload || 0) }}
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
        :y-max="iface.traffic.y_max"
        :height="28"
      />

      <div class="text-caption text-medium-emphasis mb-1">
        {{ t("$vuetify.networkLatency.monitor.fastestServers") }}
      </div>
      <div v-if="iface.servers?.length" class="iface-card__servers">
        <div v-for="srv in iface.servers" :key="srv.node_id" class="iface-card__server">
          <CountryFlag v-if="srv.country" :country="srv.country" size="small" class="flex-shrink-0" />
          <span class="text-body-2 text-truncate">{{ srv.city || srv.name }}</span>
          <v-chip v-if="srv.live" size="x-small" color="primary" variant="tonal" label class="flex-shrink-0">
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
