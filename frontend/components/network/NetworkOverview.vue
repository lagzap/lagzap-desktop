<script setup lang="ts">
import OverviewChart from "~/components/network/OverviewChart.vue";
import TopConnectionsPreview from "~/components/network/TopConnectionsPreview.vue";
import OverviewTitleGrid from "~/components/title/OverviewTitleGrid.vue";
import { getJitterAccent, getLossAccent, getScoreAccent } from "~/composables/useLatencyMetrics";
import { useOverviewChart } from "~/composables/useOverviewChart";
import { useHumanSpeed } from "~/composables/helper";
import { useLocale, useTheme } from "vuetify";

withDefaults(defineProps<{ chartHeight?: number }>(), { chartHeight: 200 });

const { t } = useLocale();
const theme = useTheme();
const isDark = computed(() => theme.current.value.dark);
const store = useStore();
const { chart, colorOf } = useOverviewChart();

const quality = computed(() => chart.value?.quality ?? null);
const showLive = computed(() => store.connected || !!quality.value?.best);
const scoreAccent = computed(() => getScoreAccent(quality.value?.score ?? 0, isDark.value));
const jitterAccent = computed(() => getJitterAccent(quality.value?.jitter ?? 0, isDark.value));
const lossAccent = computed(() => getLossAccent(quality.value?.loss ?? 0, isDark.value));

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

    <div class="overview-live px-4 mt-3">
      <div v-if="showLive" class="overview-live__card">
        <div class="overview-live__card-label">
          {{ t("$vuetify.networkLatency.networkQuality") }}
        </div>
        <div class="network-summary">
          <div v-if="quality?.best" class="network-summary__item">
            <div class="network-summary__label">
              {{ t("$vuetify.networkLatency.bestInterface") }}
            </div>
            <div class="network-summary__value d-flex align-center ga-2">
              <span
                class="network-summary__dot"
                :style="{ backgroundColor: colorOf(quality.best) }"
              />
              <span class="text-truncate">{{ quality.best }}</span>
              <span class="font-weight-medium">
                {{ formatMs(quality.latency, "--") }}
              </span>
            </div>
          </div>

          <div class="network-summary__item">
            <div class="network-summary__label">
              {{ t("$vuetify.network.download") }}
            </div>
            <div class="network-summary__value font-weight-medium">
              {{ useHumanSpeed(quality?.download ?? 0) }}
            </div>
          </div>

          <div class="network-summary__item">
            <div class="network-summary__label">
              {{ t("$vuetify.network.upload") }}
            </div>
            <div class="network-summary__value font-weight-medium text-medium-emphasis">
              {{ useHumanSpeed(quality?.upload ?? 0) }}
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
              {{ localDigits((quality?.jitter ?? 0).toFixed(1)) }} {{ msUnit() }}
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
              {{ (quality?.loss ?? 0).toFixed(1) }}%
            </div>
          </div>

          <div class="network-summary__item">
            <div class="network-summary__label">
              {{ t("$vuetify.networkLatency.score") }}
            </div>
            <div
              class="network-summary__value font-weight-medium"
              :style="metricValueStyle(scoreAccent)"
            >
              {{ t("$vuetify.networkLatency.scoreOutOf", [quality?.score ?? 0]) }}
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
      </div>

      <div class="overview-live__card">
        <OverviewChart v-if="showLive" :chart-height="chartHeight" />
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
      </div>

      <div class="overview-live__card overview-live__card--flush">
        <TopConnectionsPreview />
      </div>
    </div>

    <div class="mt-5" />
  </div>
</template>

<style scoped>
.overview-live {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.overview-live__card {
  border: thin solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  background: rgba(var(--v-theme-surface), 0.45);
  padding: 14px 16px 12px;
}

.overview-live__card--flush {
  padding: 4px 8px 8px;
  overflow: hidden;
}

.overview-live__card--flush :deep(.v-card) {
  margin-top: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
}

.overview-live__card-label {
  margin-bottom: 12px;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.network-summary {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 16px 24px;
  width: 100%;
}

.network-summary__item {
  min-width: 0;
}

.network-summary__label {
  margin-bottom: 6px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.7rem;
  white-space: nowrap;
}

.network-summary__value {
  min-width: 0;
  font-size: 0.95rem;
  line-height: 1.2;
}

.network-summary__dot {
  flex-shrink: 0;
  border-radius: 50%;
  width: 8px;
  height: 8px;
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
