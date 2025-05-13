<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import Container from "~/components/layout/Container.vue";
import { useStore } from "@/stores";
import { rand } from "@vueuse/core";
import { sum } from "es-toolkit";
import type { VDataTable, VDataTableVirtual } from "vuetify/components";

const store = useStore();
const route = useRoute();
const data = useSanctumUser<DataResponse>();

const connectionStore = useMonitoringStore(false);
const title = computed(() =>
  data.value.titles.find((title) => title.id === route.params.id)
);
const connections = computed(
  () =>
    connectionStore.connections?.value?.filter((c) =>
      new RegExp(title.value.process_regex).test(c.process)
    ) ?? []
);

const headers = ref<VDataTableVirtual["headers"]>([
  {
    title: "Server",
    key: "server",
    align: "start",
    sortable: false,
    nowrap: true,
    width: "100%",
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
    key: "upload",
    align: "center",
    sortable: true,
    nowrap: true,
  },
  {
    title: "Downlink",
    key: "download",
    align: "center",
    sortable: true,
    nowrap: true,
  },
]);

const sortBy = ref<VDataTable["sortBy"]>([
  { key: "metadata.network", order: "desc" },
  { key: "downloadSpeed", order: "desc" },
]);

onMounted(() => {
  nextTick(() => {
    if (!title.value) {
      return;
    }
    store.visitTitle(title.value.id);
  });
});
</script>

<template>
  <div>
    <Container v-if="title">
      <template #header>
        <v-avatar v-if="title.icon_url" density="comfortable">
          <v-img :src="title.icon_url" />
        </v-avatar>
        <v-app-bar-title>{{ title.name }}</v-app-bar-title>

        <v-btn
          variant="plain"
          color="secondary"
          prepend-icon="mdi-bug-outline"
          text="Report"
        />
      </template>
      <v-card-text>
        {{ title.name }}
      </v-card-text>
      <v-data-table-virtual
        :headers="headers"
        :items="connections"
        :sort-by="sortBy"
        density="comfortable"
        mobile-breakpoint="md"
        hide-default-footer
        class="bg-transparent"
      >
        <template v-slot:item.process="{ item }">
          <v-list-item
            :title="
              data.titles.find(
                (t) =>
                  t.process_regex &&
                  new RegExp(t.process_regex).test(item.process)
              )?.name ?? '-'
            "
          >
            <template #prepend>
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
            <template #append> meow </template>
          </v-list-item>
        </template>
        <template v-slot:item.server="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <CountryFlag country="gb" size="small" />
            <span>London</span>
          </div>
        </template>
        <template v-slot:item.upload="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <v-icon>mdi-arrow-up</v-icon>
            <span>{{ useHumanSize(item.uplink) }}</span>
          </div>
        </template>
        <template v-slot:item.download="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <v-icon>mdi-arrow-down</v-icon>
            <span>{{ useHumanSize(item.downlink) }}</span>
          </div>
        </template>
        <template v-slot:item.latency="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <v-icon color="green">mdi-signal-cellular-2</v-icon>
            <span class="text-green ms-1">{{ rand(80, 100) }}ms</span>
          </div>
        </template>
        <template v-slot:header.data-table-group></template>
        <template v-slot:item.data-table-group="{ item }">
          <div class="text-center text-uppercase">{{ item.network }}</div>
        </template>
        <template v-slot:group-header="{ item, columns, toggleGroup }">
          <tr v-ripple class="cursor-pointer" @click="toggleGroup(item)">
            <td>
              <v-avatar
                :image="
                  data.titles.find(
                    (t) =>
                      t.process_regex &&
                      new RegExp(t.process_regex).test(item.value)
                  )?.icon_url
                "
                size="x-small"
              />
            </td>
            <td>
              <div class="d-flex align-center">
                <CountryFlag country="gb" size="small" />
                <span>London</span>
              </div>
            </td>
            <td>
              <div class="d-flex align-center flex-nowrap">
                <v-icon color="green">mdi-signal-cellular-2</v-icon>
                <span class="text-green ms-1">{{ rand(80, 100) }}ms</span>
              </div>
            </td>
            <td>
              <div class="d-flex align-center flex-nowrap">
                <v-icon>mdi-arrow-up</v-icon>
                <span class="text-no-wrap">{{
                  useHumanSize(sum(item.items.map((x) => x.raw.uplink)))
                }}</span>
              </div>
            </td>
            <td>
              <div class="d-flex align-center flex-nowrap">
                <v-icon>mdi-arrow-down</v-icon>
                <span class="text-no-wrap">{{
                  useHumanSize(sum(item.items.map((x) => x.raw.downlink)))
                }}</span>
              </div>
            </td>
          </tr>
        </template>
      </v-data-table-virtual>
      <template #outside>
        <v-fab
          v-if="store.isTitleActive(title.id)"
          icon
          appear
          size="x-large"
          color="green"
          variant="elevated"
          style="position: fixed; bottom: 16px; right: 16px; z-index: 10000"
          @click="store.toggleActiveState(title)"
        >
          <v-icon>mdi-pause</v-icon>
        </v-fab>
        <v-fab
          v-else
          icon
          appear
          size="x-large"
          color="accent"
          variant="elevated"
          style="position: fixed; bottom: 16px; right: 16px; z-index: 10000"
          @click="store.toggleActiveState(title)"
        >
          <v-icon>mdi-play</v-icon>
        </v-fab>
      </template>
    </Container>
  </div>
</template>
