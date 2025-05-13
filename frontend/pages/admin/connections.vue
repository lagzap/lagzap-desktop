<script setup lang="ts">
import type { VDataTable, VDataTableVirtual } from "vuetify/components";
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import { useDate } from "vuetify";

const data = useSanctumUser<DataResponse>()
const store = useStore();
const { connections, closedConnections } = useMonitoringStore(true);
const items = computed(() =>
  (showClosed.value
    ? (closedConnections.value?.sort((a, b) => (a.start > b.start ? -1 : 1)) ??
      [])
    : connections.value?.sort((a, b) => (a.start > b.start ? -1 : 1)) ?? []
  ).filter((c) => hidden.value.findIndex((h) => h == c.process) == -1)
);

const search = ref<string>("");
const showClosed = ref<boolean>(false);
const hidden = ref<string[]>([]);
const headers = computed<VDataTableVirtual["headers"]>(() => {
  return [
    {
      title: "Process",
      key: "process",
      align: "start",
      sortable: false,
      nowrap: true,
      width: "auto",
    },
    {
      title: "Route",
      key: "action",
      align: "end",
      sortable: false,
      nowrap: true,
      width: "0px",
    },
    {
      title: "Prot.",
      key: "network",
      align: "center",
      sortable: false,
      nowrap: true,
      width: "0px",
    },
    {
      title: "host",
      key: "host",
      align: "start",
      sortable: false,
      nowrap: true,
    },
    {
      title: "Source",
      key: "source",
      align: "start",
      sortable: false,
      nowrap: true,
      width: "200px",
    },
    {
      title: "Destination",
      key: "destination",
      align: "start",
      sortable: false,
      nowrap: true,
      width: "200px",
    },
    {
      title: showClosed ? "Traffic" : "Speed",
      key: showClosed ? "traffic" : "speed",
      align: "center",
      sortable: true,
      nowrap: true,
      width: "120px",
    },
    {
      title: "Start",
      key: "start",
      align: "center",
      sortable: true,
      nowrap: true,
      width: "0%",
    },
  ]
});


const extractProcessName = (fullPath: string): string => {
  const parts = fullPath.split("\\");
  return parts[parts.length - 1];
};
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title>Connections</v-app-bar-title>
        <v-spacer />

        <v-text-field
          v-model:model-value="search"
          variant="solo-filled"
          rounded="xl"
          density="compact"
          label="Search"
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
            <v-card title="Hidden Processes">
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
          label="Closed"
          hide-details
        />
      </template>
      <v-data-table-virtual
        :search
        :headers
        :items
        density="compact"
        multi-sort
        fixed-header
        hide-default-footer
        class="bg-transparent h-100"
      >
        <template v-slot:item.process="{ item }">
          <v-list-item
            :title="
              data.titles.find(
                (t) =>
                  t.process_regex &&
                  new RegExp(t.process_regex).test(item.process)
              )?.name ?? extractProcessName(item.process)
            "
          >
            <template #prepend>
              <v-btn
                icon="mdi-eye-off"
                variant="tonal"
                size="sm"
                @click="hidden.push(item.process)"
              />
              <v-avatar
                size="x-small"
                :image="
                  data.titles.find(
                    (t) =>
                      t.process_regex &&
                      new RegExp(t.process_regex).test(item.process)
                  )?.icon_url
                "
              />
            </template>
          </v-list-item>
        </template>
        <template v-slot:item.action="{ item }">
          <span v-if="item.action == 'direct'" class="text-grey">{{
            item.action
          }}</span>
          <span v-else>{{ item.chains.join('→') }}</span>
        </template>
        <template v-slot:item.network="{ item }">
          <span v-if="item.network == 'tcp'" class="text-green">TCP</span>
          <span v-else class="text-red">UDP</span>
        </template>
        <template v-slot:item.destination="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <CountryFlag :country="item.geoipCode" size="small" />
            <span class="ms-1">{{ item.destination }}</span>
          </div>
        </template>
        <template v-slot:item.speed="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <span>{{ useHumanSpeed(item.speed) }}</span>
          </div>
        </template>
        <template v-slot:item.traffic="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <span>{{ useHumanSize(item.uplink + item.downlink) }}</span>
          </div>
        </template>
        <template v-slot:item.start="{ item }">
          {{ item.start }}
        </template>
      </v-data-table-virtual>
    </Container>
  </div>
</template>
