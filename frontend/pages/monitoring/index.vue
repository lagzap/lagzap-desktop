<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import NetworkMonitorPanel from "~/components/network/monitor/NetworkMonitorPanel.vue";
import ServerDirectory from "~/components/network/servers/ServerDirectory.vue";
import { useLocale } from "vuetify";
import { StartOptimizing, GetOptimizeProgress } from "~/bindings/github.com/lagzap/lagzap-desktop/service";

const locale = useLocale();
const { t } = locale;
const store = useStore();

async function optimize() {
  store.optimizeMinimized = false;
  store.optimizeProgress = {
    total_tests: 100,
    completed_tests: 0,
    is_complete: false,
    progress: 0,
    phase: "probe",
    probe_total: 0,
    probe_completed: 0,
    verify_total: 0,
    verify_completed: 0,
    interfaces: [],
  } as any;

  await StartOptimizing();

  // Poll RPC — Wails may wrap event payloads; this keeps the bar moving.
  // Ignore a premature is_complete until we've seen real work from this run
  // (stale completed snapshot from the previous optimize used to flash the panel).
  // Do not touch optimizeMinimized here — progress events used to force-expand.
  let sawLiveWork = false;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const progress = await GetOptimizeProgress();
      if (progress) {
        const probeTotal =
          progress.probe_total ?? (progress as any).probeTotal ?? 0;
        const probeDone =
          progress.probe_completed ?? (progress as any).probeCompleted ?? 0;
        const verifyTotal =
          progress.verify_total ?? (progress as any).verifyTotal ?? 0;
        const verifyDone =
          progress.verify_completed ?? (progress as any).verifyCompleted ?? 0;
        const pct = progress.progress ?? 0;
        if (probeTotal > 0 || probeDone > 0 || verifyTotal > 0 || verifyDone > 0 || pct > 0) {
          sawLiveWork = true;
        }
        const isComplete = !!(
          progress.is_complete ?? (progress as any).isComplete
        );
        if (isComplete && !sawLiveWork) {
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        store.optimizeProgress = {
          total_tests:
            progress.total_tests ?? (progress as any).totalTests ?? 100,
          completed_tests:
            progress.completed_tests ?? (progress as any).completedTests ?? 0,
          is_complete: isComplete,
          progress: pct,
          phase: progress.phase || "probe",
          probe_total: probeTotal,
          probe_completed: probeDone,
          verify_total: verifyTotal,
          verify_completed: verifyDone,
          interfaces: progress.interfaces ?? [],
        } as any;
        if (isComplete) {
          break;
        }
      }
    } catch {
      // ignore transient RPC errors
    }
    if (
      !store.optimizing &&
      (store.optimizeProgress as any)?.probe_total > 0
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          {{ t("$vuetify.navigation.monitoring") }}
        </v-app-bar-title>
      </template>
      <v-card-text class="pb-2">
        <NetworkMonitorPanel />
      </v-card-text>
      <v-card-text class="pb-16">
        <v-divider class="mb-5" />
        <ServerDirectory />
        <v-fab
          v-if="!store.optimizing"
          prepend-icon="mdi-fire"
          appear
          size="large"
          color="primary"
          variant="elevated"
          :style="{
            position: 'fixed',
            bottom: '16px',
            [locale.isRtl.value ? 'left' : 'right']: '16px',
            zIndex: 10000,
          }"
          :text="t('$vuetify.networkLatency.servers.optimize')"
          @click="optimize()"
        />
      </v-card-text>
    </Container>
  </div>
</template>
