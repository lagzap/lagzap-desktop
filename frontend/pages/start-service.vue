<script lang="ts" setup>
import { onMounted } from "vue";
import { useLocale } from "vuetify";
import { Connect, InstallDriver, IsDriverInstalled, IsLocalProxyRunning, ReloadService, UninstallDriver, CheckForUpdates } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { getHttpStatus, isAuthError, isForceUpdateError, getNetworkFailureKind } from "~/utils/httpError";
import { getToken } from "~/utils/indexedDB";
import { handleAuthFailure } from "~/composables/useAuthSession";
import { getErrorMessage } from "~/composables/alert";

const router = useRouter();
const route = useRoute();
const store = useStore();
const locale = useLocale();
const { t } = locale;
const { settings } = useSettings();
/** Open splash without ReloadService — use ?preview=1 from the app menu. */
const isPreview = computed(
  () => route.query.preview === "1" || route.query.preview === "true"
);
const showStartupOptimize = computed(
  () =>
    !isPreview.value &&
    !store.appReady &&
    !store.startupOptimizeDone &&
    store.optimizeProgress != null
);

const showStartupReady = computed(
  () => !isPreview.value && store.startupOptimizeDone && !store.appReady
);

/** Spin/arcs only until optimize/analysis finishes — not through StartProxy. */
const logoLoading = computed(
  () =>
    !isPreview.value &&
    !store.appReady &&
    !store.startupOptimizeDone &&
    !store.error &&
    !store.startupCanceled
);

const optimizeRealPct = computed(() => {
  const p = store.optimizeProgress;
  if (!p) return 0;
  const total = p.total_tests ?? 0;
  if (total > 0) {
    return Math.min(100, Math.max(0, ((p.completed_tests ?? 0) / total) * 100));
  }
  return Math.min(100, Math.max(0, p.progress ?? 0));
});
const optimizeDisplayPct = usePsychoProgress(
  optimizeRealPct,
  showStartupOptimize
);
definePageMeta({
  layout: "start",
  sanctum: {
    excluded: true,
  },
});

const errorName = ref<string | null>(null);
const errorStatusCode = ref<number | null>(null);
const errorStatusText = ref<string | null>(null);

const { init, refreshIdentity, isAuthenticated, logout } = useSanctumAuth();

/** Server rejected this build — open the updater window (startup check lives in Go). */
async function openUpdaterForForceUpdate() {
  store.statusMessage = t("$vuetify.startService.updateRequired");
  try {
    await CheckForUpdates();
  } catch {
    // Dev builds / missing updater config no-op.
  }
}

onMounted(async () => {
  await nextTick();
  if (isPreview.value) {
    store.loading = false;
    return;
  }
  await start();
});

async function leavePreview() {
  await router.replace({ name: "index" });
}

async function runStartupFromPreview() {
  await router.replace({ name: "start-service" });
  await start();
}

const driverDialog = ref(false);
const installDisclaimerDialog = ref(false);
const installingDriver = ref(false);
const installingDriverErrorDialog = ref(false);

async function installDriver() {
  installDisclaimerDialog.value = false;
  installingDriver.value = true;
  try {
    await InstallDriver();
    driverDialog.value = false;
    installDisclaimerDialog.value = false;
    installingDriver.value = false;
    await start();
  } catch (e) {
    console.error(e);
    installingDriver.value = false;
    installingDriverErrorDialog.value = true;
  }
}

const retryingInstallDriver = ref(false);
async function retryInstallDriver() {
  installingDriverErrorDialog.value = false;
  retryingInstallDriver.value = true;
  try {
    await UninstallDriver();
    retryingInstallDriver.value = false;
    installingDriverErrorDialog.value = false;
    installDriver();
  } catch (e) {
    console.error(e);
    retryingInstallDriver.value = false;
  }
}

const redirecting = ref(false);

const showCancelStartup = computed(
  () =>
    store.loading &&
    !store.error &&
    !showStartupOptimize.value &&
    !showStartupReady.value &&
    !redirecting.value,
);

async function handleCancelStartup() {
  await store.cancelStartup();
}

async function retryStartup() {
  const wasCanceled = store.startupCanceled;
  store.resetStartupCancel();
  store.error = false;
  errorName.value = null;
  errorStatusCode.value = null;
  errorStatusText.value = null;
  if (wasCanceled || !isAuthenticated.value) {
    await start();
  } else {
    await initApp();
  }
}

async function waitForLocalProxy(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await IsLocalProxyRunning()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("local auth proxy not ready");
}

async function start() {
  const isDriverInstalled = await IsDriverInstalled();
  if (!isDriverInstalled) {
    driverDialog.value = true;
    return;
  }

  store.resetStartupCancel();

  try {
    store.error = false;
    store.loading = true;
    store.statusMessage = t("$vuetify.startService.connecting");
    await ReloadService();
    if (store.startupCanceled) {
      return;
    }
    await waitForLocalProxy();
    store.statusMessage = t("$vuetify.startService.loggingIntoOnlineService");

    const token = await getToken("lz.access_token");
    if (!token) {
      redirecting.value = true;
      await handleAuthFailure();
      return;
    }

    if (!isAuthenticated.value) {
      await refreshIdentity();
    }
    if (store.startupCanceled) {
      return;
    }
  } catch (e) {
    if (store.startupCanceled) {
      return;
    }
    if (isForceUpdateError(e)) {
      store.loading = false;
      await openUpdaterForForceUpdate();
      return;
    }
    if (isAuthError(e)) {
      redirecting.value = true;
      store.error = false;
      await handleAuthFailure();
      return;
    }
    console.error(e);
    console.dir(e);
    errorName.value = (e as Error).name || "Error";
    const status = getHttpStatus(e);
    const networkKind = getNetworkFailureKind(e);
    errorStatusCode.value = status;
    if (networkKind === "timeout") {
      errorStatusText.value = t("$vuetify.startService.serverUnreachableTimeout");
    } else if (networkKind === "proxy") {
      errorStatusText.value = t("$vuetify.startService.localProxyNotReady");
    } else if (networkKind) {
      errorStatusText.value = t("$vuetify.startService.serverUnreachable");
    } else {
      errorStatusText.value = getErrorMessage(e, locale);
    }
    store.statusMessage = errorStatusText.value;
    try {
      await store.resetToPreStartup();
    } catch {
      // ignore cleanup errors
    }
    store.error = true;
    return;
  } finally {
    if (store.startupCanceled || redirecting.value || store.error) {
      store.loading = false;
      return;
    }
    if (isAuthenticated.value) {
      await initApp();
      return;
    }
    // Token present but identity never landed (e.g. raced clear) — don't freeze the splash.
    store.loading = false;
    redirecting.value = true;
    await handleAuthFailure();
  }
}

async function initApp() {
  if (store.startupCanceled) {
    store.loading = false;
    return;
  }
  try {
    await init();
  } catch (e) {
    if (store.startupCanceled) {
      return;
    }
    if (isForceUpdateError(e)) {
      store.loading = false;
      await openUpdaterForForceUpdate();
      return;
    }
    if (isAuthError(e)) {
      redirecting.value = true;
      store.error = false;
      await handleAuthFailure();
      return;
    }
    errorName.value = (e as Error).name || "Error";
    const status = getHttpStatus(e);
    const networkKind = getNetworkFailureKind(e);
    errorStatusCode.value = status;
    if (networkKind === "timeout") {
      errorStatusText.value = t("$vuetify.startService.serverUnreachableTimeout");
    } else if (networkKind === "proxy") {
      errorStatusText.value = t("$vuetify.startService.localProxyNotReady");
    } else if (networkKind) {
      errorStatusText.value = t("$vuetify.startService.serverUnreachable");
    } else {
      errorStatusText.value = getErrorMessage(e, locale);
    }
    store.error = true;
    store.statusMessage = errorStatusText.value;
    return;
  } finally {
    if (store.startupCanceled || redirecting.value) {
      store.loading = false;
      return;
    }
  }

  if (store.startupCanceled) {
    store.loading = false;
    return;
  }

  try {
    // Always connect + sync; activeOnStart only controls NDIS proxy auto-start.
    await store.initialize(undefined, {
      startProxy: settings.value.activeOnStart !== false,
    });
  } catch (e) {
    return;
  }
  if (store.startupCanceled) {
    store.loading = false;
    return;
  }
  if (store.isReady && isAuthenticated.value) {
    router.replace({ name: "index" });
  } else {
    store.loading = false;
  }
}
</script>

<template>
  <div>
    <LagZapAnimatedLogo :loading="logoLoading" />
    <div class="status-container text-center">
      <v-card-title>
        <LogoName />
      </v-card-title>

      <!-- Optimizing state content -->
      <template v-if="showStartupOptimize">
        <v-card-subtitle class="text-subtitle-1 text-accent text-center">
          {{ t("$vuetify.startService.advancedRoutingAnalysisInProgress") }}
        </v-card-subtitle>
        <v-progress-linear color="primary" :model-value="optimizeDisplayPct" rounded height="4" class="mt-2" />
      </template>
      <template v-else-if="showStartupReady">
        <v-card-subtitle class="text-subtitle-1 text-success text-center">
          {{ t("$vuetify.service.ready") }}
        </v-card-subtitle>
      </template>
      <!-- Non-optimizing state content -->
      <template v-else>
        <template v-if="isPreview">
          <v-card-subtitle class="text-subtitle-1 text-center text-medium-emphasis">
            {{ t('$vuetify.startService.previewMode') }}
          </v-card-subtitle>
          <div class="d-flex justify-center mt-3" style="gap: 0.75rem">
            <v-btn color="on-surface" density="comfortable" variant="tonal" @click="leavePreview">
              {{ t('$vuetify.startService.backToApp') }}
            </v-btn>
            <v-btn color="primary" density="comfortable" variant="tonal" @click="runStartupFromPreview">
              {{ t('$vuetify.startService.runStartup') }}
            </v-btn>
          </div>
        </template>
        <template v-else>
        <v-card-subtitle
          v-if="store.error && errorStatusText"
          class="text-subtitle-1 text-center"
          :class="isAuthenticated ? 'text-error' : 'text-warning'"
        >
          <template v-if="errorStatusCode">{{ errorStatusCode }} · </template>{{ errorStatusText }}
        </v-card-subtitle>
        <v-card-subtitle
          v-else-if="store.serviceReady && store.error"
          class="text-subtitle-1 text-error text-center"
        >
          {{ t("$vuetify.status.coordinationFailed") }}
        </v-card-subtitle>
        <v-card-subtitle v-else class="text-subtitle-1 text-center" :class="{
          'text-error': store.error,
          'text-warning': store.startupCanceled,
          'text-success': !store.error && !store.startupCanceled && store.serviceReady,
        }">
          {{ store.statusMessage }}
        </v-card-subtitle>

        <div v-if="showCancelStartup" class="d-flex justify-center mt-3">
          <v-btn color="on-surface" density="comfortable" variant="tonal" @click="handleCancelStartup">
            {{ t("$vuetify.startService.cancelStartup") }}
          </v-btn>
        </div>
        <div v-else-if="store.error || store.startupCanceled" class="d-flex justify-center mt-3" style="gap: 1rem">
          <v-btn v-if="store.error && isAuthenticated" color="warning" density="comfortable" variant="tonal"
            @click="logout">
            {{ t("$vuetify.startService.logout") }}
          </v-btn>
          <v-btn color="info" density="comfortable" variant="tonal" :loading="store.loading"
            @click="retryStartup">
            {{ t("$vuetify.startService.retry") }}
          </v-btn>
        </div>
        </template>
      </template>
    </div>
    <v-dialog v-model="driverDialog" width="500" persistent>
      <v-card :title="t('$vuetify.startService.installCyrexDriver')">
        <v-card-text>
          {{ t('$vuetify.service.driverMustBeInstalled') }}
          <br />
          <v-alert size="dense" variant="tonal" color="info" class="mt-5">
            {{ t('$vuetify.startService.driverInfo') }}
          </v-alert>
        </v-card-text>
        <template #actions>
          <v-dialog v-model="installDisclaimerDialog" max-width="550">
            <template #activator="{ props: activatorProps }">
              <v-btn size="x-large" color="success" block variant="elevated" :disabled="installDisclaimerDialog"
                v-bind="activatorProps" :loading="installingDriver">
                {{ t('$vuetify.startService.installDriver') }}
              </v-btn>
            </template>

            <v-card :title="t('$vuetify.startService.installDriverDisclaimer')">
              <v-card-text class="pt-4">
                <p class="text-body-1">
                  {{ t('$vuetify.startService.installDriverWarning') }}
                </p>
              </v-card-text>

              <v-card-actions class="justify-end">
                <v-btn color="green" variant="elevated" size="large" block :loading="installingDriver"
                  @click="installDriver">
                  {{ t('$vuetify.startService.installDriverConfirm') }}
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-dialog>
        </template>
      </v-card>
    </v-dialog>

    <v-dialog v-model="installingDriverErrorDialog" width="500" persistent>
      <v-card :title="t('$vuetify.startService.failedToInstallDriver')">
        <v-card-text>
          {{ t('$vuetify.startService.failedToInstallDriverDescription') }}
        </v-card-text>
        <template #actions>
          <v-btn color="error" variant="elevated" size="large" block @click="retryInstallDriver">
            {{ t('$vuetify.startService.retry') }}
          </v-btn>
        </template>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.status-container {
  position: fixed;
  top: calc(50% + 110px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 1002;
}

.status-container :deep(.v-card-title) {
  margin-top: 0.75rem;
  padding-top: 0;
  padding-bottom: 0.5rem;
}

.lagzap-name {
  font-weight: 600;
  font-size: 1.5rem;
}

.cyrex-name {
  font-weight: 600;
  font-size: 1.5rem;
}
</style>
