<script lang="ts" setup>
import { GetLatency, InstallDriver } from "~/bindings/github.com/lagzap/lagzap-desktop/service";

const router = useRouter();
const store = useStore();

definePageMeta({
  layout: "start",
  sanctum: {
    excluded: true,
  },
});

const { init } = useSanctumAuth();
onMounted(async () => {
  await nextTick();
  try {
    await init();
  } catch (e) {
    router.replace({ name: "auth" });
    return;
  }
  await initApp();
});

async function initApp() {
  try {
    await store.initialize();
  } catch (e) {
    return;
  }
  if (!store.driverInstalled) {
    installDriver();
    return;
  }
  if (store.serviceReady) {
    router.replace({ name: "index" });
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
      <v-card-subtitle v-else-if="!store.serviceReady && store.error" class="text-error">
        Service Failed
      </v-card-subtitle>

      <v-card-text
        class="text-center"
        :class="{
          'text-danger': store.error,
          'text-success': !store.error && store.serviceReady,
        }"
      >
        {{ store.statusMessage }}
      </v-card-text>
    </div>

    <template #actions>
      <v-spacer />
      <v-dialog v-if="store.driverInstalled === false" max-width="500">
        <template v-slot:activator="{ props: activatorProps }">
          <v-btn
            v-bind="activatorProps"
            variant="elevated"
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
                variant="elevated"
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
        v-else-if="!store.serviceReady && store.error"
        variant="elevated"
        color="primary"
        density="comfortable"
        size="large"
        class="ma-2"
        :loading="store.loading"
        @click="initApp"
      >
        Reload Service
      </v-btn>
    </template>
  </v-card>
</template>
