<script setup lang="ts">
import { useDisplay } from "vuetify";
import LagzapLogo from "~/components/LagzapLogo.vue";
import QuickAccess from "./QuickAccess.vue";
import { Events } from "@wailsapp/runtime";
import { ConnectionStatus } from "~/bindings/github.com/lagzap/lagzap/adapter";
import { useLocale } from "vuetify";

const { t } = useLocale();
const data = useSanctumUser<DataResponse>();
const user = computed(() => data.value.user);
const { mobile } = useDisplay();
const store = useStore();

const serviceReady = computed(() => store.serviceReady);
const running = computed(() => store.ndisRunning);
const model = defineModel<boolean>({
  required: false,
  default: false,
});

onActivated(async () => {
  Events.On("service-started", async () => {
    await store.startProxy();
  });

  console.log(store.serviceReady);
  if (store.serviceReady) {
    await store.startProxy();
  }
});
</script>

<template>
  <v-navigation-drawer
    v-model:model-value="model"
    :permanent="!mobile"
    :floating="!mobile"
    :color="mobile ? 'background' : 'transparent'"
  >
    <template #prepend>
      <v-list-item rounded="xl">
        <template #title>
          <span class="lagzap-name me-1">{{ t('$vuetify.app_name') }}</span>
        </template>
        <template #prepend>
          <v-avatar>
            <LagzapLogo />
          </v-avatar>
        </template>
        <template #append>
          <v-switch
            :model-value="running"
            inset
            hide-details
            density="comfortable"
            :color="store.error ? 'red' : 'green'"
            :disabled="!serviceReady"
            :loading="store.loading"
            @click.stop.prevent="store.toggleNDIS()"
          />
        </template>
      </v-list-item>
    </template>

    <template #append>
      <v-list v-if="user" nav density="compact">
        <v-list-item
          :to="{ name: 'profile' }"
          :title="user.name ?? t('$vuetify.status.player1')"
          :subtitle="store.connected ? t('$vuetify.status.unlimited') : store.status"
          rounded="xl"
        >
          <template #prepend>
            <v-avatar :variant="(user.name || user.email)?.length ? (store.status == ConnectionStatus.StatusReconnecting ? 'text' : 'tonal') : 'text'">
              <v-progress-circular v-if="store.status == ConnectionStatus.StatusReconnecting" indeterminate />
              <span v-else-if="(user.name || user.email)?.length" class="text-xl text-uppercase">{{
                (user.name || user.email)[0]
              }}</span>
              <v-icon v-else icon="mdi-account-circle" size="x-large" />
            </v-avatar>
          </template>

          <template #append>
            <v-tooltip text="Settings">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="mdi-cog"
                  text="Settings"
                  variant="plain"
                  size="small"
                  color="secondary"
                  :to="{ name: 'settings' }"
                />
              </template>
            </v-tooltip>
          </template>
        </v-list-item>
      </v-list>
    </template>

    <v-list nav :lines="false" variant="text" color="tertiary">
      <v-list-item
        :to="{ name: 'index' }"
        :title="t('$vuetify.navigation.overview')"
        prepend-icon="mdi-view-dashboard"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        :to="{ name: 'titles' }"
        :title="t('$vuetify.navigation.titles')"
        prepend-icon="mdi-gamepad"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        :to="{ name: 'console' }"
        :title="t('$vuetify.navigation.gamingConsoles')"
        prepend-icon="mdi-controller"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        :to="{ name: 'network-latency' }"
        :title="t('$vuetify.navigation.networkLatency')"
        prepend-icon="mdi-map-marker-path"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        :to="{ name: 'connections' }"
        :title="t('$vuetify.navigation.connections')"
        prepend-icon="mdi-network-outline"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        v-if="false"
        :to="{ name: 'monitoring' }"
        :title="t('$vuetify.navigation.monitoring')"
        prepend-icon="mdi-chart-line"
        rounded="xl"
        density="compact"
      />
    </v-list>

    <v-list
      v-if="store.abilities.includes('admin')"
      nav
      variant="text"
      color="tertiary"
      :lines="false"
    >
      <v-list-subheader>{{ t('$vuetify.navigation.admin') }}</v-list-subheader>
      <v-list-item
        :to="{ name: 'admin-connections' }"
        :title="t('$vuetify.navigation.connections')"
        prepend-icon="mdi-network-outline"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        :to="{ name: 'admin-logs' }"
        :title="t('$vuetify.navigation.logs')"
        prepend-icon="mdi-text"
        rounded="xl"
        density="compact"
      />
    </v-list>

    <QuickAccess />
  </v-navigation-drawer>
</template>
