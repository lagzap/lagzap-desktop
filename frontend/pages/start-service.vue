<script lang="ts" setup>
import { InstallDriver } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { useLocale } from "vuetify";

const router = useRouter();
const store = useStore();
const { t } = useLocale()

definePageMeta({
  layout: "start",
  sanctum: {
    excluded: true,
  },
});

const errorName = ref<string | null>(null)

const { init, refreshIdentity, isAuthenticated, logout } = useSanctumAuth();
onMounted(async () => {
  await nextTick();
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

  await start()
});

async function start () {
  try {
    store.loading = true;
    store.statusMessage = t("$vuetify.startService.loggingIntoOnlineService");
    if (!isAuthenticated.value) {
      await refreshIdentity();
    }
  } catch (e) {
    console.error(e);
    errorName.value = e.name;
    if (store.isReady) {
      store.stopNDIS();
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
    await store.initialize();
  } catch (e) {
    return;
  }
  console.log(store.driverInstalled)
  if (store.driverInstalled === false) {
    installDriver();
    return;
  }
  if (store.isReady) {
    redirecting.value = true;
    router.replace({ name: "index" });
  }
}

async function installDriver() {
  try {
    store.loading = true;
    store.statusMessage = t('$vuetify.startService.installingLagZapKernelDriver');
    await InstallDriver();
    store.statusMessage = t('$vuetify.startService.lagZapKernelDriverInstalledSuccessfully');
    await initApp()
  } catch (e) {
    store.statusMessage = t('$vuetify.startService.failedToInstallDriver');
    store.error = true;
  } finally {
    store.loading = false;
  }
}
</script>

<template>
  <v-card
    :loading="store.loading"
    width="100vw"
    max-width="500px"
    :class="{
      'zoom-in': !redirecting,
      'zoom-out': redirecting
    }"
  >
    <div class="d-flex flex-column align-center pt-10">
      <v-avatar size="96">
        <LagzapLogo />
      </v-avatar>
      <v-card-title>
        <span class="lagzap-name">
          {{ t("$vuetify.app_name") }}
        </span>
      </v-card-title>
      <v-card-subtitle v-if="store.driverInstalled === false" class="text-info">
        {{ t('$vuetify.status.driverMissing') }}
      </v-card-subtitle>
      <v-card-subtitle v-else-if="store.serviceReady && store.error && errorName != 'FetchError'" class="text-error">
        {{ t('$vuetify.status.coordinationFailed') }}
      </v-card-subtitle>
      <v-card-subtitle v-else-if="!store.isReady && store.error" class="text-error">
        {{ t('$vuetify.status.connectionFailed') }}
      </v-card-subtitle>

      <v-card-text
        class="text-center"
        :class="{
          'text-danger': store.error,
          'text-success': !store.error && store.isReady,
        }"
      >
        {{ store.statusMessage }}
      </v-card-text>
    </div>

    <template #actions>
      <v-btn
        v-if="!store.isReady && store.error && isAuthenticated"
        color="warning"
        density="comfortable"
        size="large"
        @click="logout"
      >
        {{ t("$vuetify.startService.logout") }}
      </v-btn>
      <v-spacer />
      <v-dialog v-if="store.driverInstalled === false" max-width="500">
        <template v-slot:activator="{ props: activatorProps }">
          <v-btn
            v-bind="activatorProps"
            color="success"
            density="comfortable"
            size="large"
            class="ma-2"
            :loading="store.loading"
          >
            {{ t("$vuetify.startService.installDriver") }}
          </v-btn>
        </template>

        <template v-slot:default="{ isActive }">
          <v-card :title="t('$vuetify.startService.installLagZapDriver')">
            <v-card-text>
              {{ t("$vuetify.startService.driverInstallationWarning") }}
            </v-card-text>

            <v-card-actions>
              <v-spacer />
              <v-btn
                color="success"
                density="comfortable"
                size="large"
                class="ma-2"
                :loading="store.loading"
                @click="
                  isActive.value = false;
                  installDriver();
                "
              >
                {{ t("$vuetify.startService.continue") }}
              </v-btn>
            </v-card-actions>
          </v-card>
        </template>
      </v-dialog>
      <v-btn
        v-else-if="!store.isReady && store.error"
        color="info"
        density="comfortable"
        size="large"
        :loading="store.loading"
        @click="isAuthenticated ? initApp() : start()"
      >
        {{ t("$vuetify.startService.retry") }}
      </v-btn>
    </template>
  </v-card>
</template>
