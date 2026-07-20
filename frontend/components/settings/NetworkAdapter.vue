<script lang="ts" setup>
import { useLocale } from "vuetify";
import { useNetworkAdapterSettings } from "~/composables/useNetworkAdapterSettings";
import {
  DEFAULT_TCP_ROUTES,
  DEFAULT_UDP_ROUTES,
  MAX_ROUTES,
} from "~/composables/routeCountUtils";

const { t } = useLocale();
const {
  defaultInterfaceOverride,
  multiInternetSelection,
  backupInterfacesSelection,
  loaded,
  refreshInterfaces,
  defaultInterface,
  interfaces,
  routeTableInterfaces,
  globalTcpRoutes,
  globalUdpRoutes,
  getInterfaceRouteOverride,
  effectiveTcpForInterface,
  effectiveUdpForInterface,
  setGlobalTcp,
  setGlobalUdp,
  setInterfaceTcp,
  setInterfaceUdp,
} = useNetworkAdapterSettings();

const { settings, setRelayTransportFallback } = useSettings();

const loading = ref(false);
const advancedOpen = ref<string[]>([]);

async function update() {
  loading.value = true;
  await refreshInterfaces();
  loading.value = false;
}

const globalTcpModel = computed({
  get: () => globalTcpRoutes.value,
  set: (value: number | null) => setGlobalTcp(value),
});

const globalUdpModel = computed({
  get: () => globalUdpRoutes.value,
  set: (value: number | null) => setGlobalUdp(value),
});
</script>

<template>
  <v-card
    :title="t('$vuetify.settings.networkAdapter')"
    flat
    class="mt-3 bg-transparent"
    max-width="720"
  >
    <v-card-text class="network-adapter-settings">
      <section class="settings-section">
        <v-card-subtitle class="px-0 mb-3 text-wrap">
          {{ t('$vuetify.settings.networkAdapterDescription') }}
        </v-card-subtitle>
        <v-select
          v-model="defaultInterfaceOverride"
          :loading="loading || !loaded"
          :label="t('$vuetify.settings.defaultInterface')"
          :hint="t('$vuetify.settings.defaultInterfaceHint')"
          :items="interfaces"
          item-value="Name"
          item-title="Name"
          density="comfortable"
          variant="outlined"
          :placeholder="
            t('$vuetify.settings.leaveInterfaceEmptyAutomatic', [defaultInterface])
          "
          clearable
          persistent-hint
          @click="update"
        />
      </section>

      <section class="settings-section">
        <v-card-subtitle class="px-0 mb-3 text-wrap">
          {{ t('$vuetify.settings.multiInternetDescription') }}
        </v-card-subtitle>
        <v-select
          v-model="multiInternetSelection"
          :loading="loading || !loaded"
          :label="t('$vuetify.settings.multiInternet')"
          :hint="t('$vuetify.settings.multiInternetHint')"
          :items="interfaces"
          item-value="Name"
          item-title="Name"
          density="comfortable"
          variant="outlined"
          multiple
          chips
          closable-chips
          clearable
          persistent-hint
          @click="update"
        />
      </section>

      <section class="settings-section">
        <v-card-subtitle class="px-0 mb-3 text-wrap">
          {{ t('$vuetify.settings.backupInterfacesDescription') }}
        </v-card-subtitle>
        <v-select
          v-model="backupInterfacesSelection"
          :loading="loading || !loaded"
          :label="t('$vuetify.settings.backupInterfaces')"
          :hint="t('$vuetify.settings.backupInterfacesHint')"
          :items="interfaces"
          item-value="Name"
          item-title="Name"
          density="comfortable"
          variant="outlined"
          multiple
          chips
          closable-chips
          clearable
          persistent-hint
          @click="update"
        />
      </section>

      <v-expansion-panels
        v-model="advancedOpen"
        variant="default"
        class="settings-section advanced-panels"
      >
        <v-expansion-panel value="advanced">
          <v-expansion-panel-title>
            {{ t('$vuetify.settings.networkAdapterAdvanced.title') }}
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-card-subtitle class="px-0 mb-3 text-wrap">
              {{ t('$vuetify.settings.routeCounts.description') }}
            </v-card-subtitle>

            <v-table density="comfortable" class="route-counts-table mb-3">
              <thead>
                <tr>
                  <th>{{ t('$vuetify.settings.routeCounts.interface') }}</th>
                  <th>{{ t('$vuetify.settings.routeCounts.tcp') }}</th>
                  <th>{{ t('$vuetify.settings.routeCounts.udp') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td class="font-weight-medium">
                    {{ t('$vuetify.settings.routeCounts.defaultRow') }}
                  </td>
                  <td>
                    <v-number-input
                      v-model="globalTcpModel"
                      variant="plain"
                      density="compact"
                      hide-details
                      control-variant="split"
                      inset
                      clearable
                      :min="0"
                      :max="MAX_ROUTES"
                      :placeholder="String(DEFAULT_TCP_ROUTES)"
                    />
                  </td>
                  <td>
                    <v-number-input
                      v-model="globalUdpModel"
                      variant="plain"
                      density="compact"
                      hide-details
                      control-variant="split"
                      inset
                      clearable
                      :min="0"
                      :max="MAX_ROUTES"
                      :placeholder="String(DEFAULT_UDP_ROUTES)"
                    />
                  </td>
                </tr>
                <tr v-for="ifaceName in routeTableInterfaces" :key="ifaceName">
                  <td>{{ ifaceName }}</td>
                  <td>
                    <v-number-input
                      :model-value="getInterfaceRouteOverride(ifaceName).tcp"
                      variant="plain"
                      density="compact"
                      hide-details
                      control-variant="split"
                      inset
                      clearable
                      :min="0"
                      :max="MAX_ROUTES"
                      :placeholder="String(effectiveTcpForInterface(ifaceName))"
                      @update:model-value="setInterfaceTcp(ifaceName, $event)"
                    />
                  </td>
                  <td>
                    <v-number-input
                      :model-value="getInterfaceRouteOverride(ifaceName).udp"
                      variant="plain"
                      density="compact"
                      hide-details
                      control-variant="split"
                      inset
                      clearable
                      :min="0"
                      :max="MAX_ROUTES"
                      :placeholder="String(effectiveUdpForInterface(ifaceName))"
                      @update:model-value="setInterfaceUdp(ifaceName, $event)"
                    />
                  </td>
                </tr>
              </tbody>
            </v-table>

            <v-checkbox
              :label="t('$vuetify.settings.route.transportFallback')"
              :hint="t('$vuetify.settings.route.transportFallbackHint')"
              persistent-hint
              :model-value="settings.relayTransportFallback"
              @update:model-value="setRelayTransportFallback"
            />
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.network-adapter-settings {
  padding-bottom: 0;
}

.settings-section + .settings-section {
  margin-top: 2rem;
}

.advanced-panels {
  margin-top: 2rem;
}

.route-counts-table :deep(th) {
  text-align: center;
}

.route-counts-table :deep(th:nth-child(2)),
.route-counts-table :deep(th:nth-child(3)),
.route-counts-table :deep(td:nth-child(2)),
.route-counts-table :deep(td:nth-child(3)) {
  width: 180px;
  min-width: 180px;
  text-align: center;
}

.route-counts-table :deep(td:nth-child(2) .v-number-input),
.route-counts-table :deep(td:nth-child(3) .v-number-input) {
  margin-inline: auto;
}

.route-counts-table :deep(.v-number-input) {
  width: 160px;
  min-width: 160px;
}

.route-counts-table :deep(.v-field__outline) {
  display: none;
}
</style>
