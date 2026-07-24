<script setup lang="ts">
import { NuxtPage } from "#components";
import { useDisplay, useLocale } from "vuetify";
import NavigationDrawer from "~/components/layout/NavigationDrawer.vue";

const { mobile } = useDisplay();
const { t } = useLocale();
const sidebar = ref(!mobile.value);
provide("sidebar", sidebar);

const store = useStore();

import { computed, onMounted, onUnmounted } from "vue";
import { useStore } from "@/stores";
import { GetNodes, GetProfiles, GetProfileStates, GetRegions, GetRoutes, GetTitles, GetTitleStates } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { useNetworkHistoryRecorder } from "~/composables/useNetworkHistoryRecorder";
import { useNetworkHistoryConsent } from "~/composables/useNetworkHistoryConsent";
import { useMonitoringStore } from "~/stores/monitoring";

// Ensure monitoring event listeners (and IDB persistence) are active.
useMonitoringStore();
const networkHistoryRecorder = useNetworkHistoryRecorder();
const { canRecord } = useNetworkHistoryConsent();

function isEmpty(obj: any) {
  return !obj || (typeof obj === "object" && Object.keys(obj).length === 0);
}

watch(
  canRecord,
  (ok) => {
    if (ok) {
      networkHistoryRecorder.start();
    } else {
      networkHistoryRecorder.stop();
    }
  },
  { immediate: true }
);

onMounted(async () => {
  if (isEmpty(store.regions)) {
    const data = await GetRegions();
    store.regions = data
  }

  if (isEmpty(store.titles)) {
    const data = await GetTitles();
    store.titles = Object.values(data)
  }

  if (isEmpty(store.profiles)) {
    const data = await GetProfiles();
    store.profiles = Object.values(data)
  }

  if (isEmpty(store.titleStates)) {
    const data = await GetTitleStates();
    store.titleStates = data
  }

  if (isEmpty(store.profileStates)) {
    const data = await GetProfileStates();
    store.profileStates = data
  }

  if (isEmpty(store.nodes)) {
    const data = await GetNodes();
    store.nodes = data
  }

  if (isEmpty(store.routes)) {
    const data = await GetRoutes();
    store.routes = data
  }
});

onUnmounted(() => {
  networkHistoryRecorder.stop();
});

const optimize = computed(() => store.optimizeProgress);
const showOptimizePanel = computed(() => store.optimizing && !!optimize.value);

/** Overall 0–100: probe is first 50%, verify is second 50%. */
const globalProgress = computed(() => {
  const o = optimize.value as any;
  if (!o) return 0;
  if (o.is_complete) return 100;

  const measureTotal = Number(o.probe_total ?? o.probeTotal ?? 0);
  const measureDone = Number(o.probe_completed ?? o.probeCompleted ?? 0);
  const confirmTotal = Number(o.verify_total ?? o.verifyTotal ?? 0);
  const confirmDone = Number(o.verify_completed ?? o.verifyCompleted ?? 0);

  let measurePct = 0;
  if (measureTotal > 0) {
    measurePct = (measureDone * 50) / measureTotal;
    if (measureDone > 0 && measurePct < 1) measurePct = 1;
    measurePct = Math.min(50, measurePct);
  } else if (o.phase === "verify" || o.phase === "done") {
    measurePct = 50;
  }

  let confirmPct = 0;
  if (confirmTotal > 0) {
    confirmPct = (confirmDone * 50) / confirmTotal;
    if (confirmDone > 0 && confirmPct < 1) confirmPct = 1;
    confirmPct = Math.min(50, confirmPct);
  } else if (o.phase === "done") {
    confirmPct = 50;
  }

  if (measureTotal > 0 || confirmTotal > 0) {
    return Math.min(99, Math.max(0, Math.round(measurePct + confirmPct)));
  }

  const backend = Number(o.progress ?? 0);
  if (Number.isFinite(backend) && backend > 0) {
    return Math.min(99, Math.round(backend));
  }
  return 0;
});

const phaseLabel = computed(() => {
  const phase = optimize.value?.phase || "probe";
  if (phase === "verify") return t("$vuetify.routeAnalysis.phaseVerifying");
  if (phase === "done") return t("$vuetify.routeAnalysis.phaseComplete");
  return t("$vuetify.routeAnalysis.phaseAnalyzing");
});

const interfaceRows = computed(() => optimize.value?.interfaces ?? []);

function minimizeOptimize() {
  store.optimizeMinimized = true;
}

function expandOptimize() {
  store.optimizeMinimized = false;
}
</script>

<template>
  <v-app>
    <NavigationDrawer v-model="sidebar" />

    <NuxtPage
      :transition="{
        name: 'zoom-transition',
        mode: 'in-out',
        type: 'transition',
        persisted: true,
      }"
    />

    <Teleport to="body">
      <v-btn
        v-if="showOptimizePanel && store.optimizeMinimized"
        class="optimize-fab"
        color="primary"
        rounded="lg"
        elevation="10"
        @click="expandOptimize"
      >
        <v-progress-circular
          class="me-2"
          color="white"
          size="18"
          width="2"
          :model-value="globalProgress"
          :indeterminate="false"
        />
        {{
          t(
            "$vuetify.routeAnalysis.fabProgress",
            Math.round(globalProgress),
            phaseLabel
          )
        }}
      </v-btn>

      <v-card
        v-if="showOptimizePanel && !store.optimizeMinimized"
        class="optimize-panel"
        color="surface"
        variant="elevated"
        density="compact"
        elevation="16"
        border
        max-width="420"
        style="--wails-draggable: drag"
      >
        <v-card-item class="pb-1">
          <template #prepend>
            <v-avatar size="32">
              <CyrexLogo />
            </v-avatar>
          </template>
          <v-card-title class="text-subtitle-1">{{
            t("$vuetify.routeAnalysis.title")
          }}</v-card-title>
          <template #append>
            <v-btn
              icon="mdi-window-minimize"
              size="small"
              variant="text"
              :aria-label="t('$vuetify.routeAnalysis.minimize')"
              @click="minimizeOptimize"
            />
          </template>
        </v-card-item>

        <v-divider />

        <v-card-text class="pt-3">
          <div class="d-flex align-center justify-space-between mb-1">
            <span class="text-caption text-medium-emphasis">{{ phaseLabel }}</span>
            <span class="text-caption font-weight-medium">{{ Math.round(globalProgress) }}%</span>
          </div>
          <v-progress-linear
            color="primary"
            height="8"
            rounded
            :model-value="globalProgress"
            class="mb-4"
          />

          <div
            v-for="iface in interfaceRows"
            :key="iface.name"
            class="mb-3"
          >
            <div class="d-flex align-center justify-space-between mb-1">
              <span class="text-body-2">{{
                iface.name || t("$vuetify.routeAnalysis.defaultInterface")
              }}</span>
              <span class="text-caption font-weight-medium"
                >{{ Math.round(iface.progress ?? 0) }}%</span
              >
            </div>
            <v-progress-linear
              :color="iface.phase === 'done' ? 'success' : 'primary'"
              height="6"
              rounded
              :model-value="iface.progress ?? 0"
            />
          </div>
        </v-card-text>
      </v-card>
    </Teleport>
  </v-app>
</template>

<style>
.optimize-panel {
  position: fixed !important;
  right: 24px;
  bottom: 24px;
  z-index: 20000 !important;
  width: min(420px, calc(100vw - 32px));
  background-color: rgb(var(--v-theme-surface)) !important;
  opacity: 1 !important;
  backdrop-filter: none !important;
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(255, 255, 255, 0.06) !important;
}

.optimize-fab {
  position: fixed !important;
  right: 24px;
  bottom: 24px;
  z-index: 20000 !important;
  text-transform: none;
}
</style>
