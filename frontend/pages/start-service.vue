<script lang="ts" setup>
import { InstallDriver, FetchData } from "~/bindings/github.com/lagzap/lagzap-desktop/service";

const router = useRouter();
const store = useStore();

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
    store.statusMessage = "Logging into online service";
    if (!isAuthenticated.value) {
      await refreshIdentity();
    }
  } catch (e) {
    console.error(e);
    errorName.value = e.name;
    if (store.isReady) {
      store.stopNDIS();
      store.stopService();
    }
    if (e.status == 401) {
      router.replace({ name: "auth" });
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
    router.replace({ name: "index" });
    await FetchData()
  }
}

async function installDriver() {
  try {
    store.loading = true;
    store.statusMessage = "Installing LagZap kernel driver";
    await InstallDriver();
    store.statusMessage = "LagZap kernel driver installed successfully";
    await initApp()
  } catch (e) {
    store.statusMessage = "Failed to install driver";
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
    class="zoom-in"
  >
    <div class="d-flex flex-column align-center pt-10">
      <v-avatar size="96">
        <LagzapLogo />
      </v-avatar>
      <v-card-title>
        <span class="lagzap-name">
          {{ __("app_name") }}
        </span>
      </v-card-title>
      <v-card-subtitle v-if="store.driverInstalled === false" class="text-info">
        Driver missing
      </v-card-subtitle>
      <v-card-subtitle v-else-if="store.serviceReady && store.error && errorName != 'FetchError'" class="text-error">
        Coordination failed
      </v-card-subtitle>
      <v-card-subtitle v-else-if="!store.isReady && store.error" class="text-error">
        Connection failed
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
        Logout
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
            Install Driver
          </v-btn>
        </template>

        <template v-slot:default="{ isActive }">
          <v-card title="Install LagZap Driver">
            <v-card-text>
              Installing the driver causes your network to be interrupted for a
              few seconds. This is required to install the driver. Please make
              sure you have saved all your work before proceeding.
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
                Continue
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
        Retry
      </v-btn>
    </template>
  </v-card>
</template>
