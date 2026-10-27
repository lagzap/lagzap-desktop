<script setup lang="ts">
import { useLocale } from "vuetify";
import InterfaceMonitorCard from "~/components/network/monitor/InterfaceMonitorCard.vue";
import { qualityColor, useNetworkMonitor } from "~/composables/useNetworkMonitor";
import { useHumanSpeed } from "~/composables/helper";

/** Per-connection network monitor: one summary card + one card per internet
 * connection. Renders the Go snapshot only. */
const { t } = useLocale();
const { monitor, range, ranges, setRange, colorOf } = useNetworkMonitor();
const summary = computed(() => monitor.value?.summary);
const interfaces = computed(() => monitor.value?.interfaces ?? []);
// With one internet there is nothing to compare or pick between.
const multi = computed(() => interfaces.value.length > 1);
const down = computed(() => summary.value?.quality === "down");

function openInterface(name: string) {
  navigateTo({ name: "monitoring-iface", params: { iface: name } });
}
</script>

<template>
  <section class="network-monitor">
    <div class="d-flex align-center mb-3">
      <span class="text-subtitle-1 font-weight-medium">
        {{ multi ? t("$vuetify.networkLatency.monitor.title") : t("$vuetify.networkLatency.monitor.titleSingle") }}
      </span>
      <v-spacer />
      <v-btn-toggle
        :model-value="range"
        density="compact"
        variant="outlined"
        divided
        mandatory
        rounded="lg"
        @update:model-value="(r: any) => setRange(r)"
      >
        <v-btn v-for="r in ranges" :key="r" :value="r" size="small">{{ r }}</v-btn>
      </v-btn-toggle>
    </div>

    <div v-if="summary && interfaces.length" class="monitor-summary mb-4">
      <div class="monitor-summary__score">
        <v-progress-circular
          :model-value="summary.score"
          :color="qualityColor(summary.quality)"
          size="72"
          width="6"
        >
          <span class="text-h6 font-weight-bold">{{ down ? "–" : summary.score }}</span>
        </v-progress-circular>
        <div class="min-w-0">
          <div class="monitor-summary__label">{{ t("$vuetify.networkLatency.monitor.quality") }}</div>
          <div class="text-h6 font-weight-medium" :class="`text-${qualityColor(summary.quality)}`">
            {{ t(`$vuetify.networkLatency.monitor.qualityWord.${summary.quality || "down"}`) }}
          </div>
          <div v-if="multi && summary.best_interface" class="text-caption text-medium-emphasis text-truncate">
            {{ t("$vuetify.networkLatency.monitor.bestIs", summary.best_interface) }}
          </div>
        </div>
      </div>

      <div class="monitor-summary__metrics">
        <div class="monitor-summary__metric">
          <span class="monitor-summary__label">{{ t("$vuetify.networkLatency.monitor.internetPing") }}</span>
          <span class="monitor-summary__value" :class="`text-${qualityColor(summary.quality)}`">
            {{ summary.best_ping > 0 ? localDigits(summary.best_ping) : "—" }}<small> {{ msUnit() }}</small>
          </span>
        </div>
        <div class="monitor-summary__metric">
          <span class="monitor-summary__label">{{ t("$vuetify.networkLatency.jitter") }}</span>
          <span class="monitor-summary__value">{{ localDigits((summary.jitter ?? 0).toFixed(1)) }}<small> {{ msUnit() }}</small></span>
        </div>
        <div class="monitor-summary__metric">
          <span class="monitor-summary__label">{{ t("$vuetify.networkLatency.loss") }}</span>
          <span class="monitor-summary__value" :class="(summary.loss ?? 0) > 1 ? 'text-error' : ''">
            {{ localDigits((summary.loss ?? 0).toFixed(1)) }}<small>{{ localDigits("%") }}</small>
          </span>
        </div>
        <div class="monitor-summary__metric">
          <span class="monitor-summary__label">{{ t("$vuetify.network.download") }}</span>
          <span class="monitor-summary__value">{{ useHumanSpeed(summary.download || 0) }}</span>
        </div>
        <div class="monitor-summary__metric">
          <span class="monitor-summary__label">{{ t("$vuetify.network.upload") }}</span>
          <span class="monitor-summary__value">{{ useHumanSpeed(summary.upload || 0) }}</span>
        </div>
        <div class="monitor-summary__metric">
          <span class="monitor-summary__label">{{ t("$vuetify.networkLatency.monitor.gameRoutesTitle") }}</span>
          <span class="monitor-summary__value">{{ summary.game_legs }}</span>
        </div>
        <div v-if="multi" class="monitor-summary__metric">
          <span class="monitor-summary__label">{{ t("$vuetify.networkLatency.monitor.connections") }}</span>
          <span class="monitor-summary__value" :class="summary.online < summary.total ? 'text-warning' : ''">
            {{ t("$vuetify.networkLatency.monitor.online", summary.online, summary.total) }}
          </span>
        </div>
      </div>
    </div>

    <div v-if="interfaces.length" class="network-monitor__grid">
      <InterfaceMonitorCard
        v-for="iface in interfaces"
        :key="iface.name"
        :iface="iface"
        :color="colorOf(iface.name)"
        :single="!multi"
        @open="openInterface(iface.name)"
      />
    </div>
    <div v-else class="text-body-2 text-medium-emphasis py-6 text-center">
      {{ t("$vuetify.networkLatency.monitor.noInterfaces") }}
    </div>
  </section>
</template>

<style scoped>
.network-monitor {
  container-type: inline-size;
}

.monitor-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px 32px;
  padding: 16px 20px;
  border: thin solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  background: rgba(var(--v-theme-surface), 0.45);
}

.monitor-summary__score {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 200px;
}

.monitor-summary__metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 12px 24px;
  flex: 1 1 280px;
  min-width: 0;
  padding-inline-start: 24px;
  border-inline-start: thin solid rgba(var(--v-theme-on-surface), 0.08);
}

.monitor-summary__metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.monitor-summary__label {
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-size: 0.7rem;
  white-space: nowrap;
}

.monitor-summary__value {
  font-size: 1rem;
  font-weight: 500;
  line-height: 1.2;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.monitor-summary__value small {
  font-size: 0.7rem;
  opacity: 0.6;
}

.network-monitor__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(340px, 100%), 1fr));
  gap: 12px;
}

.min-w-0 {
  min-width: 0;
}

@container (max-width: 640px) {
  .monitor-summary__metrics {
    padding-inline-start: 0;
    border-inline-start: none;
  }
}
</style>
