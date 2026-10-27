<script setup lang="ts">
import { Events } from "@wailsio/runtime";
import { useLocale } from "vuetify";
import { useStore } from "@/stores";

/** Progress popup for a network interface that connected mid-session: the
 * backend checks its internet, then tests every LagZap server over it alone
 * (no path analysis). Same corner as the full Optimize panel, which wins
 * while it runs. */
type IfaceState = "checking" | "probing" | "done" | "unavailable";
interface IfaceStatus {
  name: string;
  state: IfaceState;
  reason?: "no_internet" | "no_servers";
  completed: number;
  total: number;
  progress: number;
  reachable: number;
  best_ms?: number;
  recovered?: boolean;
  seq: number;
}

const store = useStore();
const { t } = useLocale();
const rows = ref<Record<string, IfaceStatus>>({});
const minimized = ref(false);
const hideTimers = new Map<string, ReturnType<typeof setTimeout>>();

const DONE_HIDE_MS = 8000;
const UNAVAILABLE_HIDE_MS = 15000;

function asObject(data: unknown): Record<string, any> | null {
  if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, any>;
  if (Array.isArray(data) && data.length === 1 && data[0] && typeof data[0] === "object") {
    return data[0] as Record<string, any>;
  }
  return null;
}

function scheduleHide(name: string, ms: number) {
  clearTimeout(hideTimers.get(name));
  hideTimers.set(
    name,
    setTimeout(() => {
      hideTimers.delete(name);
      const next = { ...rows.value };
      delete next[name];
      rows.value = next;
    }, ms)
  );
}

let off: (() => void) | undefined;
onMounted(() => {
  off = Events.On("iface-optimize", ({ data }: any) => {
    const raw = asObject(data);
    if (!raw?.name) return;
    const status = raw as IfaceStatus;
    const prev = rows.value[status.name];
    // Events arrive asynchronously; never let an older one overwrite a newer.
    if (prev && Number(status.seq) <= Number(prev.seq)) return;
    if (!prev) minimized.value = false;
    rows.value = { ...rows.value, [status.name]: status };
    if (status.state === "done") scheduleHide(status.name, DONE_HIDE_MS);
    else if (status.state === "unavailable") scheduleHide(status.name, UNAVAILABLE_HIDE_MS);
    else clearTimeout(hideTimers.get(status.name));
  });
});
onUnmounted(() => {
  off?.();
  hideTimers.forEach((timer) => clearTimeout(timer));
});

const list = computed(() => Object.values(rows.value));
// Every row is a known connection whose internet came back after an outage.
const title = computed(() =>
  list.value.length && list.value.every((row) => row.recovered)
    ? t("$vuetify.routeAnalysis.recoveredInterfaceTitle")
    : t("$vuetify.routeAnalysis.newInterfaceTitle")
);
const visible = computed(() => list.value.length > 0 && !store.optimizing);
const active = computed(() =>
  list.value.some((row) => row.state === "checking" || row.state === "probing")
);
const overall = computed(() => {
  if (!list.value.length) return 0;
  return Math.round(
    list.value.reduce((sum, row) => sum + (row.state === "checking" ? 0 : row.progress ?? 0), 0) /
      list.value.length
  );
});

function statusText(row: IfaceStatus): string {
  switch (row.state) {
    case "checking":
      return t("$vuetify.routeAnalysis.ifaceChecking");
    case "probing":
      return t("$vuetify.routeAnalysis.ifaceProbing", row.completed ?? 0, row.total ?? 0);
    case "done":
      return t("$vuetify.routeAnalysis.ifaceReady", row.best_ms ?? 0, row.reachable ?? 0);
    default:
      return row.reason === "no_internet"
        ? t("$vuetify.routeAnalysis.ifaceNoInternet")
        : t("$vuetify.routeAnalysis.ifaceNoServers");
  }
}

function barColor(row: IfaceStatus): string {
  if (row.state === "unavailable") return "warning";
  if (row.state === "done") return "success";
  return "primary";
}
</script>

<template>
  <Teleport to="body">
    <v-btn
      v-if="visible && minimized"
      class="iface-optimize-fab"
      color="primary"
      rounded="lg"
      elevation="10"
      @click="minimized = false"
    >
      <v-progress-circular
        class="me-2"
        color="white"
        size="18"
        width="2"
        :model-value="overall"
        :indeterminate="active && overall === 0"
      />
      {{ title }}
    </v-btn>

    <v-card
      v-if="visible && !minimized"
      class="iface-optimize-panel"
      color="surface"
      variant="elevated"
      density="compact"
      elevation="16"
      border
      max-width="420"
    >
      <v-card-item class="pb-1">
        <template #prepend>
          <v-avatar size="32">
            <LagzapLogo />
          </v-avatar>
        </template>
        <v-card-title class="text-subtitle-1">
          {{ title }}
        </v-card-title>
        <template #append>
          <v-btn
            icon="mdi-window-minimize"
            size="small"
            variant="text"
            :aria-label="t('$vuetify.routeAnalysis.minimize')"
            @click="minimized = true"
          />
        </template>
      </v-card-item>

      <v-divider />

      <v-card-text class="pt-3">
        <div v-for="row in list" :key="row.name" class="mb-3">
          <div class="d-flex align-center justify-space-between mb-1 ga-2">
            <span class="text-body-2 d-flex align-center ga-1">
              <v-icon
                v-if="row.state === 'unavailable'"
                icon="mdi-alert-outline"
                color="warning"
                size="16"
              />
              <v-icon
                v-else-if="row.state === 'done'"
                icon="mdi-check-circle-outline"
                color="success"
                size="16"
              />
              {{ row.name }}
            </span>
            <span
              class="text-caption text-end"
              :class="row.state === 'unavailable' ? 'text-warning' : 'text-medium-emphasis'"
              >{{ statusText(row) }}</span
            >
          </div>
          <v-progress-linear
            :color="barColor(row)"
            height="6"
            rounded
            :indeterminate="row.state === 'checking'"
            :model-value="row.state === 'unavailable' ? 100 : row.progress ?? 0"
          />
        </div>
      </v-card-text>
    </v-card>
  </Teleport>
</template>

<style>
.iface-optimize-panel {
  position: fixed !important;
  right: 24px;
  bottom: 24px;
  z-index: 20000 !important;
  width: min(420px, calc(100vw - 32px));
  background-color: rgb(var(--v-theme-surface)) !important;
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(255, 255, 255, 0.06) !important;
}

.iface-optimize-fab {
  position: fixed !important;
  right: 24px;
  bottom: 24px;
  z-index: 20000 !important;
  text-transform: none;
}
</style>
