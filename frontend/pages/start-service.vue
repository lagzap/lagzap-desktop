<script lang="ts" setup>
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
  if (store.isReady) {
    redirecting.value = true;
    router.replace({ name: "index" });
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
      <v-card-subtitle v-if="store.serviceReady && store.error && errorName != 'FetchError'" class="text-error">
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
      <v-btn
        v-if="!store.isReady && store.error"
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
