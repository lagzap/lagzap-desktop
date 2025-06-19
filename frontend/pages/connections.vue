<script setup lang="ts">
import type { VDataTable, VDataTableVirtual } from "vuetify/components";
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import country from 'country-list-js';
import { rand } from "@vueuse/core";
import { sum } from "es-toolkit";

const store = useStore();
const { connections } = useMonitoringStore(false);
const items = computed(
  () =>
    connections.value?.filter((c) =>
      store.findTitleByProcessRegex(c.process)
    ).sort((a, b) => (a.downlink + a.uplink) > (b.downlink + b.uplink) ? -1 : 1) ?? []
);

const headers = ref<VDataTableVirtual["headers"]>([
  {
    title: "Game Server",
    key: "server",
    align: "start",
    sortable: false,
    nowrap: true,
    width: "50%",
  },
  {
    title: "LagZap Server",
    key: "destination",
    align: "start",
    sortable: false,
    nowrap: true,
    width: "50%",
  },
  {
    title: "Latency",
    key: "latency",
    align: "center",
    sortable: true,
    nowrap: true,
  },
  {
    title: "Uplink",
    key: "uplinkSpeed",
    align: "center",
    sortable: true,
    nowrap: true,
  },
  {
    title: "Downlink",
    key: "downlinkSpeed",
    align: "center",
    sortable: true,
    nowrap: true,
  },
]);

const sortBy = ref<VDataTable["sortBy"]>([
  { key: "metadata.network", order: "desc" },
  { key: "downlinkSpeed", order: "desc" },
]);
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title>
          Connections
        </v-app-bar-title>

        <v-spacer />
      </template>
      <v-data-table-virtual
        :headers
        :items
        :sort-by
        :group-by="[
          {
            key: 'process',
            order: 'desc',
          },
        ]"
        density="comfortable"
        mobile-breakpoint="md"
        fixed-header
        hide-default-footer
        class="bg-transparent h-100"
      >
        <template #item.process="{ item }">
          <v-list-item
            :title="store.findTitleByProcessRegex(item.process)?.name ?? '-'"
          >
            <template #prepend>
              <v-avatar
                size="x-small"
                :image="store.findTitleByProcessRegex(item.process)?.icon_url"
              />
            </template>
          </v-list-item>
        </template>
        <template #item.server="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <CountryFlag
              :country="item.geoipCode"
              size="small" />
            <span class="ms-1">
              {{ item.destination }}
            </span>
          </div>
        </template>
        <template #item.destination="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <CountryFlag
              :country="item.geoipCode"
              size="small" />
            <span class="ms-1">
              {{ country.findByIso2(item.geoipCode.toUpperCase())?.name ?? '-' }}
            </span>
          </div>
        </template>
        <template #item.uplinkSpeed="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <v-icon>
              mdi-arrow-up
            </v-icon>
            <span>
              {{ useHumanSpeed(item.uplinkSpeed) }}
            </span>
          </div>
        </template>
        <template #item.downlinkSpeed="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <v-icon>
              mdi-arrow-down
            </v-icon>
            <span>
              {{ useHumanSpeed(item.downlinkSpeed) }}
            </span>
          </div>
        </template>
        <template #item.latency="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <v-icon color="green">
              mdi-signal-cellular-2
            </v-icon>
            <span class="text-green ms-1">
              {{ rand(80, 100) }}ms
            </span>
          </div>
        </template>
        <template #header.data-table-group/>
        <template #item.data-table-group="{ item }">
          <v-chip
            :color="item.network == 'tcp' ? 'blue' : 'red'"
            size="x-small"
            variant="tonal"
            rounded>
            <span class="text-uppercase">
              {{ item.network }}
            </span>
          </v-chip>
        </template>
        <template #group-header="{ item, columns, toggleGroup }">
          <tr
            v-ripple
            class="cursor-pointer bg"
            @click="toggleGroup(item)">
            <td>
              <v-avatar
                :image="store.findTitleByProcessRegex(item.value)?.icon_url"
                size="x-small"
              />
            </td>
            <td>
              <div class="d-flex align-center">
                <CountryFlag
                  :country="item.items[0].raw.geoipCode"
                  size="small" />
                <span class="ms-1">
                  {{ item.items[0].raw.destination }}
                </span>
              </div>
            </td>
            <td>
              <div class="d-flex align-center">
                <CountryFlag
                  :country="item.items[0].raw.geoipCode"
                  size="small" />
                <span class="ms-1">
                  {{ country.findByIso2(item.items[0].raw.geoipCode.toUpperCase())?.name ?? '-' }}
                </span>
              </div>
            </td>
            <td>
              <div class="d-flex align-center flex-nowrap">
                <v-icon color="green">
                  mdi-signal-cellular-2
                </v-icon>
                <span class="text-green ms-1">
                  {{ rand(80, 100) }}ms
                </span>
              </div>
            </td>
            <td>
              <div class="d-flex align-center flex-nowrap">
                <v-icon>
                  mdi-arrow-up
                </v-icon>
                <span class="text-no-wrap">{{
                  useHumanSpeed(sum(item.items.map((x) => x.raw.uplinkSpeed)))
                }}</span>
              </div>
            </td>
            <td>
              <div class="d-flex align-center flex-nowrap">
                <v-icon>
                  mdi-arrow-down
                </v-icon>
                <span class="text-no-wrap">{{
                  useHumanSpeed(sum(item.items.map((x) => x.raw.downlinkSpeed)))
                }}</span>
              </div>
            </td>
          </tr>
        </template>
      </v-data-table-virtual>
    </Container>
  </div>
</template>
