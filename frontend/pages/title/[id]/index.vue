<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import { useStore } from "@/stores";
import { rand } from "@vueuse/core";
import { sum } from "es-toolkit";
import type { VDataTable, VDataTableVirtual } from "vuetify/components";

const store = useStore();
const route = useRoute();

const connectionStore = useMonitoringStore(false);
const title = computed(() => store.titles[route.params.id as string]);
const connections = computed(
  () =>
    connectionStore.connections?.value?.filter((c) =>
      title.value.profiles.find((p) =>
        new RegExp(p.process_regex).test(c.process)
      )
    ) ?? []
);

const activeProfiles = computed(() => 
  title.value?.profiles?.filter(profile => store.isProfileActive(profile.id)).map(profile => profile.id) ?? []
);

const toggleProfile = async (profile: any) => {
  if (!title.value) return;
  
  if (store.isProfileActive(profile.id)) {
    await store.deactivateProfile(title.value.id, profile.id);
  } else {
    await store.activateProfile(title.value.id, profile.id);
  }
};

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
  <v-card-text>
    <v-card
      title="Server"
      subtitle="Automatic selection"
      append-icon="mdi-chevron-right"
      :to="{ name: 'title-id-server', params: { id: title?.id } }"
    >
      <template #prepend>
        <v-icon class="me-3">mdi-network</v-icon>
      </template>
    </v-card>

    <v-item-group
      v-if="title"
      :model-value="activeProfiles"
      selected-class="bg-primary"
      multiple
    >
      <v-row>
        <v-col
          v-for="profile in title.profiles"
          :key="profile.id"
          cols="12"
          xl="4"
          lg="6"
        >
          <v-item v-slot="{ isSelected }" :value="profile.id">
            <v-card
              :title="profile.name"
              subtitle="Automatic Server"
              class="mt-3"
              append-icon="mdi-chevron-right"
              @click=""
            >
              <template v-slot:prepend>
                <v-switch
                  :model-value="store.isProfileActive(profile.id)"
                  inset
                  hide-details
                  intermediate
                  class="me-4"
                  color="green"
                  @click.stop.prevent="toggleProfile(profile)"
                />
              </template>

              <v-card-text v-if="profile.description?.length">
                {{ profile.description }}
              </v-card-text>
            </v-card>
          </v-item>
        </v-col>
      </v-row>
    </v-item-group>

    <v-card v-if="connections.length > 0" class="mt-3 pb-3">
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
              store.findTitleByProcessRegex(item.process)?.name ?? '-'
            "
          >
            <template #prepend>
              <v-avatar
                size="x-small"
                :image="
                  store.findTitleByProcessRegex(item.process)?.icon_url
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
                :image="store.findTitleByProcessRegex(item.value)?.icon_url"
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
    </v-card>
  </v-card-text>
</template>
