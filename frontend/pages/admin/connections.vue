<script setup lang="ts">
import type { VDataTableVirtual } from "vuetify/components";
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import { useLocale, type DataTableHeader } from "vuetify";

const { t } = useLocale()
const { connections, closedConnections } = useMonitoringStore();
const items = computed(() =>
  (showClosed.value
    ? (closedConnections.value?.sort((a, b) => (a.start > b.start ? -1 : 1)) ??
      [])
    : connections.value?.sort((a, b) => (a.start > b.start ? -1 : 1)) ?? []
  )
);

const search = ref<string>("");
const showClosed = ref<boolean>(false);
const hidden = ref<string[]>([]);
const headers = computed<DataTableHeader[]>(() => {
  return [
    {
      title: "Process",
      key: "process",
      align: "start" as const,
      nowrap: true,
      width: "auto",
      minWidth: "250px"
    },
    {
      title: "Network",
      key: "network",
      align: "center" as const,
      nowrap: true,
      width: "0px",
    },
    {
      title: "Source",
      key: "source",
      align: "start" as const,
      nowrap: true,
      width: "200px",
    },
    {
      title: "Destination",
      key: "destination",
      align: "start" as const,
      nowrap: true,
      width: "200px",
    },
    {
      title: "Host",
      key: "host",
      align: "start" as const,
      nowrap: true,
    },
    {
      title: "Usage",
      key: "download",
      align: "center" as const,
      nowrap: true,
      width: "120px",
    },
    {
      title: "Speed",
      key: "download_speed",
      align: "center" as const,
      nowrap: true,
      width: "120px",
    },
    {
      title: "Start",
      key: "start",
      align: "center" as const,
      nowrap: true,
      width: "0%",
    },
  ]
});
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title>{{ t('$vuetify.navigation.connections') }}</v-app-bar-title>
      </template>
      <v-toolbar class="bg-transparent px-3">
        <v-text-field
          v-model:model-value="search"
          variant="solo-filled"
          rounded="xl"
          density="compact"
          :label="t('$vuetify.common.search')"
          prepend-inner-icon="mdi-magnify"
          hide-details
          single-line
          style="width: 200px"
        />
        <v-spacer />
        <v-dialog max-width="500">
          <template v-slot:activator="{ props: activatorProps }">
            <v-btn
              v-bind="activatorProps"
              color="surface-variant"
              text="Hidden"
              variant="flat"
            />
          </template>

          <template v-slot:default="{ isActive }">
            <v-card :title="t('$vuetify.network.hiddenProcesses')">
              <v-list>
                <v-list-item
                  v-for="(processName, i) in hidden"
                  :key="i"
                  :title="processName"
                  @click="hidden = hidden.filter((h) => h != processName); isActive.value = false"
                />
              </v-list>
            </v-card>
          </template>
        </v-dialog>
        <v-switch
          v-model:model-value="showClosed"
          :label="t('$vuetify.common.closed')"
          hide-details
        />
      </v-toolbar>
      <v-data-table-virtual
        :search
        :headers
        :items
        density="compact"
        multi-sort
        fixed-header
        hide-default-footer
        class="bg-transparent"
      >
        <template v-slot:item.process="{ item }">
          <span>{{ item.process }}</span>
          <v-tooltip>
            <template #activator="{ props }">
              <v-icon v-bind="props">mdi-information</v-icon>
            </template>
            <pre>{{ item }}</pre>
          </v-tooltip>
        </template>
        <template v-slot:item.network="{ item }">
          <span v-if="item.network == 'tcp'" class="text-green">{{ t('$vuetify.network.tcp') }}</span>
          <span v-else class="text-blue">{{ t('$vuetify.network.udp') }}</span>
        </template>
        <template v-slot:item.source="{ item }">
          <span>{{ item.source_ip }}:{{ item.source_port }}</span>
        </template>
        <template v-slot:item.destination="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <CountryFlag
              v-if="item.country_code"
              :country="item.country_code"
              size="small"
            />
            <span class="ms-1">{{ item.destination_ip }}:{{ item.destination_port }}</span>
          </div>
        </template>
        <template v-slot:item.download_speed="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <span>{{ useHumanSpeed((item.upload_speed || 0) + (item.download_speed || 0)) }}</span>
          </div>
        </template>
        <template v-slot:item.download="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <span>{{ useHumanSize((item.upload || 0) + (item.download || 0)) }}</span>
          </div>
        </template>
        <template v-slot:item.start="{ item }">
          {{ new Date(item.start).toLocaleTimeString() }}
        </template>
      </v-data-table-virtual>
    </Container>
  </div>
</template>
