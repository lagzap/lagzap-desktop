<script setup lang="ts">
import type { VDataTableVirtual } from "vuetify/components";
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import { useLocale, type DataTableHeader } from "vuetify";

const { t } = useLocale();
const { connections } = useMonitoringStore();
const items = computed(
  () => connections.value?.sort((a, b) => (a.start > b.start ? -1 : 1)) ?? []
);

const search = ref<string>("");
const headers = computed<DataTableHeader[]>(() => {
  return [
    {
      title: "Process",
      key: "process",
      align: "start" as const,
      nowrap: true,
      width: "auto",
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
  ];
});
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">{{
          t("$vuetify.navigation.connections")
        }}</v-app-bar-title>
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
      </v-toolbar>
      <v-data-table-virtual
        :search
        :headers
        :items
        density="compact"
        multi-sort
        fixed-header
        hide-default-footer
        :height="$vuetify.display.height - 120"
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
          <span v-if="item.network == 'tcp'" class="text-green">{{
            t("$vuetify.network.tcp")
          }}</span>
          <span v-else class="text-blue">{{ t("$vuetify.network.udp") }}</span>
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
            <span class="ms-1"
              >{{ item.destination_ip }}:{{ item.destination_port }}</span
            >
          </div>
        </template>
        <template v-slot:item.download_speed="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <span>{{
              useHumanSpeed(
                (item.upload_speed || 0) + (item.download_speed || 0)
              )
            }}</span>
          </div>
        </template>
        <template v-slot:item.download="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <span>{{
              useHumanSize((item.upload || 0) + (item.download || 0))
            }}</span>
          </div>
        </template>
        <template v-slot:item.start="{ item }">
          {{ new Date(item.start).toLocaleTimeString() }}
        </template>
      </v-data-table-virtual>
    </Container>
  </div>
</template>
