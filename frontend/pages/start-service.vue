<script lang="ts" setup>
import { useLocale } from "vuetify";
import { Connect, InstallDriver, IsDriverInstalled, ReloadService, UninstallDriver } from "~/bindings/github.com/lagzap/lagzap-desktop/service";

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

async function start() {
  const isDriverInstalled = await IsDriverInstalled();
  if (!isDriverInstalled) {
    driverDialog.value = true;
    return;
  }

  try {
    store.error = false;
    store.loading = true;
    store.statusMessage = t("$vuetify.startService.startingService");
    await ReloadService();
    store.statusMessage = t("$vuetify.startService.loggingIntoOnlineService");
    if (!isAuthenticated.value) {
      await refreshIdentity();
    }
  } catch (e) {
    console.error(e);
    console.dir(e);
    store.error = true;
    errorName.value = e.name;
    errorStatusCode.value = e.response?.status ?? 0;
    errorStatusText.value = e.response?.statusText ?? 'unknown';
    if (store.isReady) {
      store.stopProxy();
      store.disconnect();
    }
    if (e.status == 401) {
      router.replace({ name: "auth" });
      redirecting.value = true;
    } else {
      store.error = true;
      store.statusMessage = getErrorMessage(e);
    }
    return;
  } finally {
    if (isAuthenticated.value) {
      await initApp();
    } else {
      store.loading = false;
    }
  }
}

const redirecting = ref(false);
async function initApp() {
  try {
    await init();
  } catch (e) {
    errorName.value = e.name;
    if (e.status == 401) {
      router.replace({ name: "auth" });
    } else {
      store.error = true;
      store.statusMessage = getErrorMessage(e);
    }
    return;
  } finally {
    store.loading = false;
  }

  try {
    await store.initialize();
  } catch (e) {
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
    <LagZapAnimatedLogo v-if="isLagZap" :loading="store.optimizing || !store.error" />
    <CyrexAnimatedLogo v-else :loading="store.optimizing || !store.error" />
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
          'text-success': !store.error && store.serviceReady,
        }">
          {{ store.statusMessage }}
        </v-card-subtitle>

        <div class="d-flex justify-center mt-3" style="gap: 1rem">
          <v-btn v-if="store.error && isAuthenticated" color="warning" density="comfortable" variant="tonal"
            @click="logout">
            {{ t("$vuetify.startService.logout") }}
          </v-btn>
          <v-btn v-if="store.error" color="info" density="comfortable" variant="tonal" :loading="store.loading"
            @click="isAuthenticated ? initApp() : start()">
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
