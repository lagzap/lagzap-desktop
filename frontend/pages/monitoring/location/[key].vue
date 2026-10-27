<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import { useLocale, useTheme } from "vuetify";
import Container from "~/components/layout/Container.vue";
import LiveChart from "~/components/network/LiveChart.vue";
import { interfaceBaseColor } from "~/composables/useLatencyMetrics";
import { qualityColor, useLocationMonitor } from "~/composables/useNetworkMonitor";
import type { OverviewRange } from "~/composables/useOverviewChart";
import type { LiveLatencyChart } from "~/types/liveChart";

/** One LagZap location: live latency of every path into it and the traffic
 * of every game routed through it. Go streams every number. */
const { t } = useLocale();
const theme = useTheme();
const route = useRoute();
const key = computed(() => String(route.params.key ?? ""));
const { location, range, ranges, setRange, setWatching } = useLocationMonitor(key);

const details = computed(() => location.value?.details ?? null);
const missing = computed(() => !!location.value && !details.value);
const watching = computed(() => !!location.value?.watching);
const inUse = computed(() => !!location.value?.in_use);
const multi = computed(() => (details.value?.connections?.length ?? 0) > 1);

const STATUS_COLOR: Record<string, string> = {
  online: "success",
  busy: "warning",
  unreachable: "error",
  not_measured: "grey",
};

const latency = computed<LiveLatencyChart | null>(() => {
  const c = location.value?.latency;
  if (!c?.series?.length) return null;
  return { ...c, series: c.series.map((s) => ({ id: s.name, label: s.name, points: s.points })) };
});
const traffic = computed(() => (location.value?.traffic?.series?.length ? location.value.traffic : null));

// Colors follow series order so a path keeps its color while the page is open.
const latencyIds = computed(() => latency.value?.series.map((s) => s.id) ?? []);
const trafficIds = computed(() => traffic.value?.series.map((s) => s.name) ?? []);
const latencyColor = (id: string) =>
  interfaceBaseColor(id, Math.max(0, latencyIds.value.indexOf(id)), theme.current.value.dark);
const trafficColor = (name: string) =>
  interfaceBaseColor(name, Math.max(0, trafficIds.value.indexOf(name)), theme.current.value.dark);

const best = computed(() => {
  const conns = details.value?.connections ?? [];
  return conns.find((c) => c.fastest) ?? conns.find((c) => c.ping > 0) ?? null;
});

function routeLabel(r: { kind: string; via?: string[] | null }): string {
  return r.kind === "via" && r.via?.length
    ? t("$vuetify.networkLatency.servers.via", r.via.join(" → "))
    : t("$vuetify.networkLatency.servers.direct");
}

function transports(r: { udp: boolean; tcp: boolean }): string {
  return [r.udp ? "UDP" : "", r.tcp ? "TCP" : ""].filter(Boolean).join(" · ");
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
          {{ details?.city ?? "" }}
        </v-app-bar-title>
      </template>

      <div class="loc-page px-4 pt-4 pb-8">
        <v-alert v-if="missing" type="warning" variant="tonal" density="compact">
          {{ t("$vuetify.networkLatency.location.missing") }}
        </v-alert>

        <div v-else-if="!details" class="text-center py-12">
          <v-progress-circular indeterminate color="primary" />
        </div>

        <template v-else>
          <!-- Hero -->
          <div class="loc-card loc-hero">
            <div class="loc-hero__head">
              <CountryFlag :country="details.country" size="big" class="loc-flag" />
              <div class="min-w-0 flex-grow-1">
                <div class="d-flex align-center flex-wrap ga-2">
                  <span class="text-h6 font-weight-medium text-truncate">{{ details.city }}</span>
                  <v-chip :color="STATUS_COLOR[details.status] ?? 'grey'" size="x-small" variant="tonal" label>
                    {{ t(`$vuetify.networkLatency.servers.status.${details.status || "not_measured"}`) }}
                  </v-chip>
                  <v-chip v-if="inUse" color="primary" size="x-small" variant="tonal" label prepend-icon="mdi-transit-connection-variant">
                    {{ t("$vuetify.networkLatency.monitor.inUse") }}
                  </v-chip>
                </div>
                <div class="text-caption text-medium-emphasis text-truncate">{{ details.region }}</div>
              </div>
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

            <div class="loc-metrics">
              <div class="loc-metric">
                <span class="loc-label">{{ t("$vuetify.networkLatency.location.bestPing") }}</span>
                <span v-if="best?.ping" :class="`text-${qualityColor(best.quality)}`">
                  {{ localDigits(best.ping) }}<small> {{ msUnit() }}</small>
                </span>
                <span v-else>—</span>
              </div>
              <div v-if="multi && best" class="loc-metric">
                <span class="loc-label">{{ t("$vuetify.networkLatency.monitor.best") }}</span>
                <span class="text-truncate">{{ best.name }}</span>
              </div>
              <div class="loc-metric">
                <span class="loc-label">{{ t("$vuetify.networkLatency.location.livePaths") }}</span>
                <span>{{ localDigits(location?.latency?.series?.length ?? 0) }}</span>
              </div>
              <div class="loc-metric">
                <span class="loc-label">{{ t("$vuetify.networkLatency.location.games") }}</span>
                <span class="text-truncate">{{ location?.games?.length ? location.games.join(", ") : "—" }}</span>
              </div>
              <div class="loc-metric">
                <span class="loc-label">{{ t("$vuetify.networkLatency.location.servers") }}</span>
                <span>{{ localDigits(details.servers?.length ?? 0) }}</span>
              </div>
            </div>
          </div>

          <!-- Latency -->
          <div class="loc-card">
            <div class="loc-card__head">
              <div class="loc-title mb-0">{{ t("$vuetify.networkLatency.location.latencyTitle") }}</div>
              <v-spacer />
              <v-btn
                v-if="!inUse && watching"
                size="small"
                variant="text"
                prepend-icon="mdi-eye-off-outline"
                @click="setWatching(false)"
              >
                {{ t("$vuetify.networkLatency.location.stopWatching") }}
              </v-btn>
            </div>
            <LiveChart
              v-if="latency"
              :latency="latency"
              :traffic="location?.traffic"
              :range="range"
              :latency-color="latencyColor"
              :traffic-color="trafficColor"
              :chart-height="260"
              fixed-view="latency"
            />
            <div v-else class="loc-empty">
              <template v-if="watching || inUse">
                <v-progress-circular indeterminate size="28" width="3" color="primary" class="mb-3" />
                <div class="text-body-2">{{ t("$vuetify.networkLatency.location.measuring") }}</div>
              </template>
              <template v-else>
                <v-icon icon="mdi-chart-line-variant" size="36" class="mb-2 text-medium-emphasis" />
                <div class="text-body-2 mb-1">{{ t("$vuetify.networkLatency.location.notInUse") }}</div>
                <div class="text-caption text-medium-emphasis mb-4">
                  {{ t("$vuetify.networkLatency.location.watchHint") }}
                </div>
                <v-btn color="primary" variant="flat" prepend-icon="mdi-eye-outline" @click="setWatching(true)">
                  {{ t("$vuetify.networkLatency.location.watch") }}
                </v-btn>
              </template>
            </div>
          </div>

          <!-- Traffic -->
          <div class="loc-card">
            <div class="loc-title">{{ t("$vuetify.networkLatency.location.trafficTitle") }}</div>
            <LiveChart
              v-if="traffic"
              :latency="latency"
              :traffic="traffic"
              :range="range"
              :latency-color="latencyColor"
              :traffic-color="trafficColor"
              :chart-height="200"
              fixed-view="traffic"
            />
            <div v-else class="loc-empty loc-empty--small">
              <div class="text-caption text-medium-emphasis">
                {{ t("$vuetify.networkLatency.location.noTraffic") }}
              </div>
            </div>
          </div>

          <div class="loc-grid">
            <!-- Ways to reach -->
            <div class="loc-card">
              <div class="loc-title">{{ t("$vuetify.networkLatency.servers.routes") }}</div>
              <div class="text-caption text-medium-emphasis mb-2">
                {{ t("$vuetify.networkLatency.servers.routesHint") }}
              </div>
              <div v-if="details.routes?.length" class="loc-rows">
                <div v-for="(r, i) in details.routes" :key="i" class="loc-row">
                  <v-icon
                    :icon="r.kind === 'via' ? 'mdi-transit-connection-variant' : 'mdi-arrow-right-thin'"
                    size="18"
                    class="text-medium-emphasis flex-shrink-0"
                  />
                  <div class="d-flex flex-column min-w-0 flex-grow-1">
                    <span class="text-body-2 text-truncate">{{ routeLabel(r) }}</span>
                    <span class="text-caption text-medium-emphasis text-truncate">
                      <template v-if="r.available">{{ t("$vuetify.networkLatency.servers.worksOver", transports(r)) }}</template>
                      <template v-else>{{ t("$vuetify.networkLatency.servers.routeBlocked") }}</template>
                    </span>
                  </div>
                  <v-chip v-if="r.in_use" size="x-small" color="primary" variant="tonal" label class="flex-shrink-0">
                    {{ t("$vuetify.networkLatency.monitor.inUse") }}
                  </v-chip>
                  <span
                    v-if="r.available"
                    class="text-body-2 font-weight-medium loc-row__value"
                    :class="`text-${qualityColor(r.quality)}`"
                  >{{ formatMs(r.ping) }}</span>
                  <v-icon v-else icon="mdi-close-circle-outline" color="error" size="18" class="flex-shrink-0" />
                </div>
              </div>
              <div v-else class="text-caption text-medium-emphasis">
                {{ t("$vuetify.networkLatency.servers.noRoutes") }}
              </div>
            </div>

            <div class="d-flex flex-column ga-3 min-w-0">
              <!-- Ping from each connection -->
              <div v-if="multi" class="loc-card">
                <div class="loc-title">{{ t("$vuetify.networkLatency.servers.fromYourConnections") }}</div>
                <div class="loc-rows">
                  <div v-for="conn in details.connections" :key="conn.name" class="loc-row">
                    <v-icon icon="mdi-lan-connect" size="18" class="text-medium-emphasis flex-shrink-0" />
                    <span class="text-body-2 text-truncate flex-grow-1">{{ conn.name }}</span>
                    <v-chip v-if="conn.fastest" size="x-small" color="success" variant="tonal" label class="flex-shrink-0">
                      {{ t("$vuetify.networkLatency.servers.fastest") }}
                    </v-chip>
                    <v-chip
                      v-if="conn.status === 'no_internet'"
                      size="x-small"
                      color="error"
                      variant="tonal"
                      label
                      class="flex-shrink-0"
                    >
                      {{ t("$vuetify.networkLatency.monitor.statusNoInternet") }}
                    </v-chip>
                    <span
                      v-if="conn.ping"
                      class="text-body-2 font-weight-medium loc-row__value"
                      :class="`text-${qualityColor(conn.quality)}`"
                    >{{ formatMs(conn.ping) }}</span>
                    <span v-else class="text-caption text-medium-emphasis loc-row__value">—</span>
                  </div>
                </div>
              </div>

              <!-- Servers -->
              <div class="loc-card">
                <div class="loc-title">{{ t("$vuetify.networkLatency.servers.serversHere") }}</div>
                <div class="loc-rows">
                  <div v-for="srv in details.servers" :key="srv.name" class="loc-row">
                    <v-icon icon="mdi-server-network" size="18" class="text-medium-emphasis flex-shrink-0" />
                    <span class="text-body-2 text-truncate flex-grow-1">{{ srv.name }}</span>
                    <v-chip
                      size="x-small"
                      :color="STATUS_COLOR[srv.status] ?? 'grey'"
                      variant="tonal"
                      label
                      class="flex-shrink-0"
                    >
                      {{ t(`$vuetify.networkLatency.servers.status.${srv.status || "not_measured"}`) }}
                    </v-chip>
                    <span class="text-body-2 text-medium-emphasis loc-row__value">{{ formatMs(srv.ping) }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </Container>
  </div>
</template>

<style scoped>
.loc-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  container-type: inline-size;
}

.loc-card {
  min-width: 0;
  border: thin solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  background: rgba(var(--v-theme-surface), 0.45);
  padding: 14px 16px;
}

.loc-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  min-height: 28px;
}

.loc-title {
  margin-bottom: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.loc-hero {
  padding: 18px 20px;
}

.loc-hero__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
  margin-bottom: 18px;
}

.loc-flag {
  flex: none;
}

.loc-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 14px 24px;
}

.loc-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 1rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.loc-metric small {
  font-size: 0.7rem;
  opacity: 0.6;
}

.loc-label {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.7rem;
  font-weight: 400;
  white-space: nowrap;
}

.loc-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 32px 16px;
}

.loc-empty--small {
  padding: 16px;
}

.loc-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}

.loc-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.loc-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.03);
  font-variant-numeric: tabular-nums;
}

.loc-row__value {
  flex: none;
  min-width: 52px;
  text-align: end;
  white-space: nowrap;
}

.min-w-0 {
  min-width: 0;
}

.v-locale--is-rtl .flip-rtl {
  transform: scaleX(-1);
}

@container (max-width: 720px) {
  .loc-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
