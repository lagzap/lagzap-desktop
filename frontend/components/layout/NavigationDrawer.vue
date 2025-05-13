<script setup lang="ts">
import { useDisplay } from "vuetify";
import LagzapLogo from "~/components/LagzapLogo.vue";
import QuickAccess from "./QuickAccess.vue";
import { Events } from "@wailsapp/runtime";

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
    await store.startNDIS();
  });

  console.log(store.serviceReady);
  if (store.serviceReady) {
    await store.startNDIS();
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
          <span class="lagzap-name">LagZap</span>
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
          :title="user.name ?? 'Player'"
          subtitle="No active subscription"
          rounded="xl"
        >
          <template #prepend>
            <v-avatar color="secondary" size="small">
              <span v-if="!!user.name" class="text-xl text-uppercase">{{
                user.name[0]
              }}</span>
              <v-icon icon="mdi-account" />
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
                  :to="{ name: 'settings' }"
                />
              </template>
            </v-tooltip>
          </template>
        </v-list-item>
      </v-list>
    </template>

    <v-list nav :lines="false">
      <v-list-item
        :to="{ name: 'index' }"
        title="Overview"
        prepend-icon="mdi-view-dashboard"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        :to="{ name: 'console' }"
        title="Xbox & PlayStation"
        prepend-icon="mdi-controller"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        :to="{ name: 'titles' }"
        title="Apps & Games"
        prepend-icon="mdi-gamepad"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        :to="{ name: 'network-latency' }"
        title="Network Latency"
        prepend-icon="mdi-map-marker-path"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        :to="{ name: 'connections' }"
        title="Connections"
        prepend-icon="mdi-network-outline"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        :to="{ name: 'monitoring' }"
        title="Monitoring"
        prepend-icon="mdi-chart-line"
        rounded="xl"
        density="compact"
      />
    </v-list>

    <v-list
      v-if="store.abilities.includes('admin')"
      nav
      :lines="false"
    >
      <v-list-subheader>Admin</v-list-subheader>
      <v-list-item
        :to="{ name: 'admin-connections' }"
        title="Connections"
        prepend-icon="mdi-network-outline"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        :to="{ name: 'admin-logs' }"
        title="Logs"
        prepend-icon="mdi-text"
        rounded="xl"
        density="compact"
      />
    </v-list>

    <QuickAccess />
  </v-navigation-drawer>
</template>
