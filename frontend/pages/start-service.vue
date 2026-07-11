<script lang="ts" setup>
import { onMounted } from "vue";
import { useLocale } from "vuetify";
import { Connect, InstallDriver, IsDriverInstalled, IsLocalProxyRunning, ReloadService, UninstallDriver } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { getHttpStatus, isAuthError } from "~/utils/httpError";
import { getToken } from "~/utils/indexedDB";
import { handleAuthFailure } from "~/composables/useAuthSession";

const router = useRouter();
const store = useStore();
const { t } = useLocale();
const isLagZap = computed(() => store.isLagZap);
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

onMounted(async () => {
  await nextTick();
  await start();
});

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
  () => store.loading && !store.error && !store.optimizing && !redirecting.value,
);

async function handleCancelStartup() {
  await store.cancelStartup();
}

async function retryStartup() {
  const wasCanceled = store.startupCanceled;
  store.resetStartupCancel();
  store.error = false;
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
    store.statusMessage = t("$vuetify.startService.startingService");
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
    if (isAuthError(e)) {
      redirecting.value = true;
      store.error = false;
      await handleAuthFailure();
      return;
    }
    console.error(e);
    console.dir(e);
    store.error = true;
    errorName.value = (e as Error).name;
    errorStatusCode.value = getHttpStatus(e) ?? 0;
    errorStatusText.value = (e as { statusMessage?: string; response?: { statusText?: string } }).statusMessage
      ?? (e as { response?: { statusText?: string } }).response?.statusText
      ?? "unknown";
    if (store.isReady) {
      if (store.ndisRunning) {
        store.stopProxy();
      }
      store.disconnect();
    }
    store.statusMessage = getErrorMessage(e);
    return;
  } finally {
    if (store.startupCanceled || redirecting.value) {
      store.loading = false;
      return;
    }
    if (isAuthenticated.value) {
      await initApp();
    } else {
      store.loading = false;
    }
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
    if (isAuthError(e)) {
      redirecting.value = true;
      store.error = false;
      await handleAuthFailure();
      return;
    }
    errorName.value = (e as Error).name;
    store.error = true;
    store.statusMessage = getErrorMessage(e);
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
    await store.initialize();
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
    <LagZapAnimatedLogo v-if="isLagZap" :loading="store.optimizing || (!store.error && !store.startupCanceled)" />
    <CyrexAnimatedLogo v-else :loading="store.optimizing || (!store.error && !store.startupCanceled)" />
    <div class="status-container text-center">
      <v-card-title>
        <LogoName />
      </v-card-title>

      <!-- Optimizing state content -->
      <template v-if="store.optimizing">
        <v-card-subtitle class="text-subtitle-1 text-accent text-center">
          {{ t("$vuetify.startService.advancedRoutingAnalysisInProgress") }}
        </v-card-subtitle>
        <v-progress-linear color="primary" :model-value="(store.optimizeProgress.completed_tests /
            store.optimizeProgress.total_tests) *
          100
          " rounded height="4" class="mt-2" />
        <v-card-subtitle class="text-subtitle-2 text-primary text-center mt-3">
          {{ store.statusMessage }}
        </v-card-subtitle>
      </template>
      <!-- Non-optimizing state content -->
      <template v-else>
        <v-card-subtitle v-if="store.serviceReady && store.error && errorName != 'FetchError'"
          class="text-subtitle-1 text-error text-center">
          {{ t("$vuetify.status.coordinationFailed") }}
        </v-card-subtitle>
        <v-card-subtitle v-else-if="store.error && !isAuthenticated && errorName == 'FetchError'"
          class="text-subtitle-1 text-warning text-center">
          {{ errorStatusCode }}
          {{ errorStatusText }}
        </v-card-subtitle>
        <v-card-subtitle v-else-if="store.error && !isAuthenticated" class="text-subtitle-1 text-warning text-center">
          {{ t("$vuetify.status.connectionFailed") }}
          {{ errorName }}
        </v-card-subtitle>
        <v-card-subtitle v-else class="text-subtitle-1 text-center" :class="{
          'text-error': store.error,
          'text-warning': store.startupCanceled,
          'text-success': !store.error && !store.startupCanceled && store.serviceReady,
        }">
          {{ store.statusMessage }}
        </v-card-subtitle>

        <div v-if="showCancelStartup" class="d-flex justify-center mt-3">
          <v-btn color="grey" density="comfortable" variant="tonal" @click="handleCancelStartup">
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
    </div>
    <v-dialog v-model="driverDialog" width="500" persistent>
      <v-card :title="t('$vuetify.startService.installLagZapDriver')">
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
  top: 60%;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1002;
  text-shadow: 0 0 10px rgba(0, 0, 0, 0.8);
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
