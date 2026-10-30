<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import { useLocale } from "vuetify";
import Container from "~/components/layout/Container.vue";
import LiveChart from "~/components/network/LiveChart.vue";
import { qualityColor, useInterfaceMonitor, useNetworkMonitor } from "~/composables/useNetworkMonitor";
import { useHumanSpeed } from "~/composables/helper";
import type { OverviewRange } from "~/composables/useOverviewChart";
import type { LiveLatencyChart } from "~/types/liveChart";

/** One internet connection in full. Go streams every number; this page
 * only lays them out. */
const { t } = useLocale();
const route = useRoute();
const name = computed(() => String(route.params.iface ?? ""));
const { detail, range, ranges, setRange } = useInterfaceMonitor(name);
const { colorOf } = useNetworkMonitor();

const iface = computed(() => detail.value?.interface);
const ping = computed(() => iface.value?.ping);
const stats = computed(() => ping.value?.stats);
const missing = computed(() => iface.value?.status === "disconnected");
const down = computed(() => ping.value?.quality === "down");
const color = computed(() => colorOf(name.value));

const KIND_ICON: Record<string, string> = {
  ethernet: "mdi-ethernet",
  wifi: "mdi-wifi",
  cellular: "mdi-signal-cellular-3",
  ppp: "mdi-lan-connect",
};
const STATUS_COLOR: Record<string, string> = { online: "success", no_internet: "error", warming: "info" };
const STATUS_KEY: Record<string, string> = {
  online: "statusOnline",
  no_internet: "statusNoInternet",
  warming: "statusWarming",
};

const latency = computed<LiveLatencyChart | null>(() => {
  const c = detail.value?.latency;
  if (!c?.series?.length) return null;
  return { ...c, series: c.series.map((s) => ({ id: s.name, label: s.name, points: s.points })) };
});

const SERVERS_SHOWN = 8;
const showAllServers = ref(false);
const servers = computed(() => iface.value?.servers ?? []);
const shownServers = computed(() => (showAllServers.value ? servers.value : servers.value.slice(0, SERVERS_SHOWN)));
// Bar length is relative to the slowest listed server.
const slowest = computed(() => Math.max(1, ...servers.value.map((s) => s.latency)));

function linkSpeed(bits: number): string {
  if (!bits) return "—";
  if (bits >= 1e9) return `${localDigits(+(bits / 1e9).toFixed(1))} Gbps`;
  if (bits >= 1e6) return `${localDigits(Math.round(bits / 1e6))} Mbps`;
  return `${localDigits(Math.round(bits / 1e3))} Kbps`;
}

function routeLabel(via?: string[] | null): string {
  return via?.length
    ? t("$vuetify.networkLatency.servers.via", via.join(" → "))
    : t("$vuetify.networkLatency.servers.direct");
}
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-btn icon="mdi-arrow-left" variant="text" size="small" class="flip-rtl" :to="{ name: 'monitoring' }" />
        <v-app-bar-title class="text-subtitle-1">
          <span class="text-medium-emphasis">{{ t("$vuetify.navigation.monitoring") }}</span>
          <span class="text-medium-emphasis mx-1">/</span>
          {{ name }}
        </v-app-bar-title>
      </template>

      <div class="iface-page px-4 pt-4 pb-8">
        <v-alert v-if="missing" type="warning" variant="tonal" density="compact">
          {{ t("$vuetify.networkLatency.monitor.detail.missing") }}
        </v-alert>

        <div v-else-if="!detail" class="text-center py-12">
          <v-progress-circular indeterminate color="primary" />
        </div>

        <template v-else-if="iface && ping && stats">
          <!-- Hero -->
          <div class="iface-page__card iface-hero">
            <div class="iface-hero__accent" :style="{ background: color }" />
            <div class="iface-hero__head">
              <v-avatar size="44" rounded="lg" :style="{ background: `${color}22` }">
                <v-icon :icon="KIND_ICON[iface.kind] ?? 'mdi-lan'" :color="color" size="24" />
              </v-avatar>
              <div class="min-w-0">
                <div class="d-flex align-center ga-2">
                  <span class="text-h6 font-weight-medium text-truncate">{{ iface.name }}</span>
                  <v-chip :color="STATUS_COLOR[iface.status] ?? 'grey'" size="x-small" variant="tonal" label>
                    {{ t(`$vuetify.networkLatency.monitor.${STATUS_KEY[iface.status] ?? "statusOnline"}`) }}
                  </v-chip>
                </div>
                <div class="text-caption text-medium-emphasis text-truncate">
                  <template v-if="iface.isp">{{ iface.isp }} · </template>
                  {{ detail.info.description || t(`$vuetify.networkLatency.monitor.detail.kind.${iface.kind}`) }}
                  <template v-if="detail.info.link_speed"> · {{ linkSpeed(detail.info.link_speed) }}</template>
                </div>
              </div>
              <v-spacer />
              <v-btn-toggle
                :model-value="range"
                density="compact"
                variant="outlined"
                divided
                mandatory
                rounded="lg"
                @update:model-value="(r: any) => setRange(r as OverviewRange)"
              >
                <v-btn v-for="r in ranges" :key="r" :value="r" size="small">{{ r }}</v-btn>
              </v-btn-toggle>
            </div>

            <div class="iface-hero__body">
              <div class="iface-hero__ping">
                <v-progress-circular
                  :model-value="ping.score"
                  :color="qualityColor(ping.quality)"
                  size="88"
                  width="7"
                >
                  <div class="d-flex flex-column align-center">
                    <span class="text-h5 font-weight-bold">{{ down ? "–" : localDigits(ping.score) }}</span>
                    <span class="iface-hero__label">/100</span>
                  </div>
                </v-progress-circular>
                <div>
                  <div class="iface-hero__label">{{ t("$vuetify.networkLatency.monitor.internetPing") }}</div>
                  <div>
                    <span class="text-h3 font-weight-bold" :class="`text-${qualityColor(ping.quality)}`">
                      {{ ping.now > 0 ? localDigits(ping.now) : "—" }}
                    </span>
                    <span class="text-body-2 text-medium-emphasis ms-1">
                      {{ ping.now > 0 ? msUnit() : t("$vuetify.networkLatency.monitor.timeout") }}
                    </span>
                  </div>
                  <div class="text-body-2 font-weight-medium" :class="`text-${qualityColor(ping.quality)}`">
                    {{ t(`$vuetify.networkLatency.monitor.qualityWord.${ping.quality || "down"}`) }}
                  </div>
                </div>
              </div>

              <div class="iface-hero__metrics">
                <div class="iface-metric">
                  <span class="iface-hero__label">{{ t("$vuetify.networkLatency.avg") }}</span>
                  <span>{{ stats.avg ? localDigits(Math.round(stats.avg)) : "—" }}<small> {{ msUnit() }}</small></span>
                </div>
                <div class="iface-metric">
                  <span class="iface-hero__label">{{ t("$vuetify.networkLatency.min") }} / {{ t("$vuetify.networkLatency.max") }}</span>
                  <span>{{ stats.min ? localDigits(stats.min) : "—" }} / {{ stats.max ? localDigits(stats.max) : "—" }}<small> {{ msUnit() }}</small></span>
                </div>
                <div class="iface-metric">
                  <span class="iface-hero__label">{{ t("$vuetify.networkLatency.jitter") }}</span>
                  <span>{{ localDigits(stats.jitter.toFixed(1)) }}<small> {{ msUnit() }}</small></span>
                </div>
                <div class="iface-metric">
                  <span class="iface-hero__label">{{ t("$vuetify.networkLatency.loss") }}</span>
                  <span :class="stats.loss > 1 ? 'text-error' : ''">{{ localDigits(stats.loss.toFixed(1)) }}<small>{{ localDigits('%') }}</small></span>
                </div>
                <div class="iface-metric">
                  <span class="iface-hero__label">{{ t("$vuetify.networkLatency.monitor.detail.uptime") }}</span>
                  <span :class="detail.uptime >= 0 && detail.uptime < 99 ? 'text-warning' : ''">
                    {{ detail.uptime >= 0 ? localDigits(detail.uptime.toFixed(1)) : "—" }}<small v-if="detail.uptime >= 0">{{ localDigits('%') }}</small>
                  </span>
                </div>
                <div class="iface-metric">
                  <span class="iface-hero__label">{{ t("$vuetify.networkLatency.monitor.detail.timeouts") }}</span>
                  <span :class="detail.timeouts > 0 ? 'text-warning' : ''">{{ localDigits(detail.timeouts) }}</span>
                </div>
                <div class="iface-metric">
                  <span class="iface-hero__label">{{ t("$vuetify.network.download") }}</span>
                  <span>{{ useHumanSpeed(iface.traffic.download || 0) }}</span>
                </div>
                <div class="iface-metric">
                  <span class="iface-hero__label">{{ t("$vuetify.network.upload") }}</span>
                  <span>{{ useHumanSpeed(iface.traffic.upload || 0) }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Charts -->
          <div class="iface-page__card">
            <div class="iface-page__title">{{ t("$vuetify.networkLatency.monitor.internetPing") }}</div>
            <LiveChart
              :latency="latency"
              :traffic="detail.traffic"
              :range="range"
              :latency-color="() => color"
              :traffic-color="() => color"
              :chart-height="240"
              fixed-view="latency"
              compact
              hide-stats
            />
          </div>

          <div class="iface-page__card">
            <div class="iface-page__title">{{ t("$vuetify.networkLatency.monitor.traffic") }}</div>
            <LiveChart
              :latency="latency"
              :traffic="detail.traffic"
              :range="range"
              :latency-color="() => color"
              :traffic-color="() => color"
              :chart-height="200"
              fixed-view="traffic"
              compact
            />
          </div>

          <div class="iface-page__grid">
            <!-- Game routes -->
            <div class="iface-page__card">
              <div class="iface-page__title">{{ t("$vuetify.networkLatency.monitor.detail.gameRoutes") }}</div>
              <div v-if="detail.routes?.length" class="iface-rows">
                <div v-for="(r, i) in detail.routes" :key="i" class="iface-row">
                  <v-avatar size="28" rounded="lg" class="flex-shrink-0">
                    <v-img v-if="r.icon" :src="r.icon" />
                    <v-icon v-else icon="mdi-application-outline" size="18" />
                  </v-avatar>
                  <div class="d-flex flex-column min-w-0">
                    <span class="text-body-2 font-weight-medium text-truncate">{{ r.game }}</span>
                    <span class="text-caption text-medium-emphasis d-flex align-center ga-1 min-w-0">
                      <CountryFlag v-if="r.country" :country="r.country" size="small" class="iface-flag" />
                      <span class="text-truncate">{{ r.city }} · {{ routeLabel(r.via) }} · {{ r.network.toUpperCase() }}</span>
                    </span>
                  </div>
                  <v-spacer />
                  <span
                    v-if="r.ping"
                    class="text-body-2 font-weight-bold flex-shrink-0"
                    :class="`text-${qualityColor(r.quality)}`"
                  >{{ formatMs(r.ping) }}</span>
                </div>
              </div>
              <div v-else class="text-body-2 text-medium-emphasis py-4 text-center">
                {{ t("$vuetify.networkLatency.monitor.detail.noGameRoutes") }}
              </div>
            </div>

            <!-- Servers -->
            <div class="iface-page__card">
              <div class="iface-page__title">{{ t("$vuetify.networkLatency.monitor.detail.servers") }}</div>
              <div v-if="servers.length" class="iface-rows">
                <div v-for="srv in shownServers" :key="srv.node_id" class="iface-row iface-row--server">
                  <CountryFlag v-if="srv.country" :country="srv.country" size="small" class="iface-flag" />
                  <span class="text-body-2 text-truncate iface-row__city">{{ srv.city || srv.name }}</span>
                  <v-chip v-if="srv.live" size="x-small" color="primary" variant="tonal" label class="flex-shrink-0">
                    {{ t("$vuetify.networkLatency.monitor.inUse") }}
                  </v-chip>
                  <div class="iface-bar">
                    <div
                      class="iface-bar__fill"
                      :class="`bg-${qualityColor(srv.quality)}`"
                      :style="{ width: `${Math.max(4, (srv.latency / slowest) * 100)}%` }"
                    />
                  </div>
                  <span class="text-caption text-medium-emphasis text-uppercase flex-shrink-0">{{ srv.network }}</span>
                  <span class="text-body-2 font-weight-medium iface-row__ping" :class="`text-${qualityColor(srv.quality)}`">
                    {{ formatMs(srv.latency) }}
                  </span>
                </div>
                <v-btn
                  v-if="servers.length > SERVERS_SHOWN"
                  variant="text"
                  size="small"
                  class="align-self-start mt-1"
                  @click="showAllServers = !showAllServers"
                >
                  {{ showAllServers
                    ? t("$vuetify.networkLatency.monitor.detail.showLess")
                    : t("$vuetify.networkLatency.monitor.detail.showAll", servers.length) }}
                </v-btn>
              </div>
              <div v-else class="text-body-2 text-medium-emphasis py-4 text-center">
                {{ t("$vuetify.networkLatency.monitor.noServers") }}
              </div>
            </div>
          </div>

          <!-- Adapter -->
          <div class="iface-page__card">
            <div class="iface-page__title">{{ t("$vuetify.networkLatency.monitor.detail.adapter") }}</div>
            <div class="iface-facts">
              <div>
                <span class="iface-hero__label">{{ t("$vuetify.networkLatency.monitor.detail.type") }}</span>
                <span>{{ t(`$vuetify.networkLatency.monitor.detail.kind.${iface.kind}`) }}</span>
              </div>
              <div>
                <span class="iface-hero__label">{{ t("$vuetify.networkLatency.monitor.detail.isp") }}</span>
                <span class="text-truncate">{{ iface.isp ? (iface.asn ? `${iface.isp} (AS${iface.asn})` : iface.isp) : "—" }}</span>
              </div>
              <div>
                <span class="iface-hero__label">{{ t("$vuetify.networkLatency.monitor.detail.linkSpeed") }}</span>
                <span>{{ linkSpeed(detail.info.link_speed) }}</span>
              </div>
              <div>
                <span class="iface-hero__label">{{ t("$vuetify.networkLatency.monitor.detail.addresses") }}</span>
                <span class="text-truncate">{{ detail.info.addresses?.join(", ") || "—" }}</span>
              </div>
              <div>
                <span class="iface-hero__label">MAC</span>
                <span>{{ detail.info.mac || "—" }}</span>
              </div>
              <div>
                <span class="iface-hero__label">MTU</span>
                <span>{{ detail.info.mtu ? localDigits(detail.info.mtu) : "—" }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </Container>
  </div>
</template>

<style scoped>
.iface-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  container-type: inline-size;
}

.iface-page__card {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: thin solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  background: rgba(var(--v-theme-surface), 0.45);
  padding: 14px 16px;
}

.iface-page__title {
  margin-bottom: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.iface-page__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
  gap: 12px;
}

.iface-hero {
  padding: 18px 20px;
}

.iface-hero__accent {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
}

.iface-hero__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}

.iface-hero__body {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 20px 36px;
}

.iface-hero__ping {
  display: flex;
  align-items: center;
  gap: 20px;
  font-variant-numeric: tabular-nums;
}

.iface-hero__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px 24px;
  flex: 1 1 320px;
  min-width: 0;
  padding-inline-start: 28px;
  border-inline-start: thin solid rgba(var(--v-theme-on-surface), 0.08);
}

.iface-hero__label {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.7rem;
  white-space: nowrap;
}

.iface-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 1rem;
  font-weight: 500;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.iface-metric small {
  font-size: 0.7rem;
  opacity: 0.6;
}

.iface-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.iface-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  font-variant-numeric: tabular-nums;
}

.iface-row__city {
  flex: 1 1 90px;
  min-width: 0;
}

.iface-flag {
  flex: none;
}

.iface-row__ping {
  width: 56px;
  flex: none;
  text-align: end;
}

.iface-bar {
  flex: 0 1 120px;
  height: 6px;
  border-radius: 3px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  overflow: hidden;
  min-width: 32px;
}

.iface-bar__fill {
  height: 100%;
  border-radius: 3px;
  opacity: 0.8;
}

.iface-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 14px 24px;
}

.iface-facts > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 0.9rem;
}

.min-w-0 {
  min-width: 0;
}

.v-locale--is-rtl .flip-rtl {
  transform: scaleX(-1);
}

@container (max-width: 760px) {
  .iface-hero__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding-inline-start: 0;
    border-inline-start: none;
  }
}

/* A narrow card has no room for the ping bar. */
@container (max-width: 520px) {
  .iface-bar {
    display: none;
  }
}
</style>
