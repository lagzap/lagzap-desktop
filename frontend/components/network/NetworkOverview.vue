<script setup lang="ts">
import LatencyPanel from "~/components/network/LatencyPanel.vue";
import TopConnectionsPreview from "~/components/network/TopConnectionsPreview.vue";
import OverviewTitleGrid from "~/components/title/OverviewTitleGrid.vue";
import {
  getBestInterfaceName,
  getJitterAccent,
  getLossAccent,
  getScoreAccent,
  interfaceBaseColor,
  isPingTimeout,
  useLatencyMetrics,
} from "~/composables/useLatencyMetrics";
import { useHumanSpeed } from "~/composables/helper";
import { useLocale, useTheme } from "vuetify";

withDefaults(
  defineProps<{
    chartHeight?: number;
  }>(),
  {
    chartHeight: 200,
  }
);

const { t } = useLocale();
const theme = useTheme();
const isDark = computed(() => theme.current.value.dark);
const store = useStore();
const { networkSpeedHistory, networkTraffic } = useMonitoringStore();

const { lastPingMs, combinedScore, combinedMetrics, chartData } =
  useLatencyMetrics(computed(() => store.latency), {
    pingCache: computed(() => store.latencyPingCache),
  });

const bestInterfaceName = computed(() => {
  if (!store.latency?.interfaces) {
    return null;
  }
  return getBestInterfaceName(store.latency.interfaces);
});

const bestInterfaceColor = computed(() => {
  const name = bestInterfaceName.value;
  if (!name) {
    return "#888";
  }
  if (chartData.value.interfaceColors[name]) {
    return chartData.value.interfaceColors[name];
  }
  const order = chartData.value.rankedInterfaces;
  return interfaceBaseColor(name, Math.max(0, order.indexOf(name)));
});

const bestInterfaceLatency = computed(() => {
  const name = bestInterfaceName.value;
  const iface = name ? store.latency?.interfaces?.[name] : null;
  if (!iface?.pings?.length) {
    return lastPingMs.value;
  }

  const lastPing = iface.pings[iface.pings.length - 1];
  if (lastPing.ok && !isPingTimeout(lastPing.latency, lastPing.ok)) {
    return lastPing.latency;
  }

  return lastPingMs.value;
});

const currentDownloadSpeed = computed(() => {
  const interfaces = networkTraffic.value?.interfaces ?? [];
  if (interfaces.length > 0) {
    return interfaces.reduce(
      (sum, iface) => sum + (iface.download_speed || 0),
      0
    );
  }

  const latest = networkSpeedHistory.value.at(-1);
  if (!latest?.interfaces) {
    return 0;
  }

  return Object.values(latest.interfaces).reduce(
    (sum, iface) => sum + (iface.download ?? 0),
    0
  );
});

const currentUploadSpeed = computed(() => {
  const interfaces = networkTraffic.value?.interfaces ?? [];
  if (interfaces.length > 0) {
    return interfaces.reduce((sum, iface) => sum + (iface.upload_speed || 0), 0);
  }

  const latest = networkSpeedHistory.value.at(-1);
  if (!latest?.interfaces) {
    return 0;
  }

  return Object.values(latest.interfaces).reduce(
    (sum, iface) => sum + (iface.upload ?? 0),
    0
  );
});

const scoreAccent = computed(() =>
  getScoreAccent(combinedScore.value, isDark.value)
);
const jitterAccent = computed(() =>
  getJitterAccent(combinedMetrics.value.jitter || 0, isDark.value)
);
const lossAccent = computed(() =>
  getLossAccent(combinedMetrics.value.loss || 0, isDark.value)
);

function metricValueStyle(accent: string | null) {
  return accent ? { color: accent } : undefined;
}
</script>

<template>
  <div>
    <div class="overview-status px-4 pt-4">
      <AccountStatusStrip />
    </div>

    <OverviewTitleGrid />

    <v-divider class="mx-4 mt-3" />

    <v-card flat class="bg-transparent">
      <v-card-text v-if="store.connected" class="py-3">
        <div class="network-summary">
          <div v-if="bestInterfaceName" class="network-summary__item">
            <div class="network-summary__label">
              {{ t("$vuetify.networkLatency.bestInterface") }}
            </div>
            <div class="network-summary__value d-flex align-center ga-2">
              <span
                class="network-summary__dot"
                :style="{ backgroundColor: bestInterfaceColor }"
              />
              <span class="text-truncate">{{ bestInterfaceName }}</span>
              <span class="font-weight-medium">
                {{
                  bestInterfaceLatency !== null
                    ? `${bestInterfaceLatency}${t("$vuetify.ms")}`
                    : "--"
                }}
              </span>
            </div>
          </div>

          <div class="network-summary__item">
            <div class="network-summary__label">
              {{ t("$vuetify.network.download") }}
            </div>
            <div class="network-summary__value font-weight-medium">
              {{ useHumanSpeed(currentDownloadSpeed) }}
            </div>
          </div>

          <div class="network-summary__item">
            <div class="network-summary__label">
              {{ t("$vuetify.network.upload") }}
            </div>
            <div class="network-summary__value font-weight-medium text-medium-emphasis">
              {{ useHumanSpeed(currentUploadSpeed) }}
            </div>
          </div>

          <div class="network-summary__item">
            <div class="network-summary__label">
              {{ t("$vuetify.networkLatency.jitter") }}
            </div>
            <div
              class="network-summary__value font-weight-medium"
              :style="metricValueStyle(jitterAccent)"
            >
              {{ combinedMetrics.jitter.toFixed(1) }}{{ t("$vuetify.ms") }}
            </div>
          </div>

          <div class="network-summary__item">
            <div class="network-summary__label">
              {{ t("$vuetify.networkLatency.loss") }}
            </div>
            <div
              class="network-summary__value font-weight-medium"
              :style="metricValueStyle(lossAccent)"
            >
              {{ combinedMetrics.loss.toFixed(1) }}%
            </div>
          </div>

          <div class="network-summary__item">
            <div class="network-summary__label">
              {{ t("$vuetify.networkLatency.networkQuality") }}
            </div>
            <div
              class="network-summary__value font-weight-medium"
              :style="metricValueStyle(scoreAccent)"
            >
              {{ t("$vuetify.networkLatency.scoreOutOf", [combinedScore]) }}
            </div>
          </div>
        </div>

        <v-alert
          v-if="store.internetStatus === 'offline'"
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-3"
          :text="t('$vuetify.status.offlineHint')"
        />
        <v-alert
          v-else-if="store.internetStatus === 'reconnecting'"
          type="info"
          variant="tonal"
          density="compact"
          class="mt-3"
          :text="t('$vuetify.status.internetReconnecting')"
        />
      </v-card-text>
    </v-card>

    <v-divider class="mx-4" />

    <v-card flat class="mt-3 bg-transparent">
      <v-card-text class="pt-3">
        <div v-if="store.connected">
          <LatencyPanel
            :latency="store.latency"
            :ping-cache="store.latencyPingCache"
            :chart-height="chartHeight"
            :network-speed-history="networkSpeedHistory"
            show-legend
            show-network-speed
          />
        </div>
        <div v-else-if="store.appReady" class="text-center text-grey py-6">
          <v-icon icon="mdi-chart-line-variant" size="large" class="mb-2" />
          <div class="text-body-2">
            {{ t("$vuetify.status.latencyUnavailableOffline") }}
          </div>
        </div>
        <div v-else class="text-center text-grey py-6">
          <v-icon icon="mdi-lan-disconnect" size="large" class="mb-2" />
          <div class="text-body-2">
            {{ t("$vuetify.status.connectionFailed") }}
          </div>
        </div>
      </v-card-text>
    </v-card>

    <v-divider class="mx-4" />

    <TopConnectionsPreview />

    <div class="mt-5" />
  </div>
</template>

<style scoped>
.network-summary {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 20px 28px;
  width: 100%;
}

.network-summary__item {
  min-width: 0;
}

.network-summary__label {
  font-size: 0.7rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
  margin-bottom: 6px;
  white-space: nowrap;
}

.network-summary__value {
  font-size: 0.95rem;
  line-height: 1.2;
  min-width: 0;
}

.network-summary__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

@media (max-width: 1100px) {
  .network-summary {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .network-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px 20px;
  }
}
</style>
