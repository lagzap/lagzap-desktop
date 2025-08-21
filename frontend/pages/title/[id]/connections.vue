<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import { useStore } from "@/stores";
import type { VDataTable, VDataTableVirtual } from "vuetify/components";
import { useLocale, type DataTableHeader } from "vuetify";

const locale = useLocale();
const { t } = locale;
const store = useStore();
const route = useRoute();

const { connections } = useMonitoringStore();
const title = computed(() =>
  store.titles.find((t) => t.id === (route.params.id as string))
);
const headers = ref<DataTableHeader[]>([
  {
    title: t("$vuetify.connections.title"),
    key: "title",
    sortable: false,
    nowrap: true,
    width: "100%",
    fixed: true,
  },
  {
    title: t("$vuetify.connections.network"),
    key: "network",
    align: "start",
    sortable: false,
    nowrap: true,
  },
  {
    title: t("$vuetify.connections.gameServer"),
    key: "server",
    align: "start",
    sortable: false,
    nowrap: true,
  },
  {
    title: t("$vuetify.connections.lagzapServer"),
    key: "destination",
    sortable: false,
    nowrap: true,
  },
  {
    title: t("$vuetify.connections.latency"),
    key: "latency",
    sortable: false,
    nowrap: true,
    minWidth: "100px",
  },
  {
    title: t("$vuetify.connections.download"),
    key: "download_speed",
    sortable: true,
    nowrap: true,
    minWidth: "130px",
  },
  {
    title: "",
    key: "action",
    sortable: false,
    align: "end",
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
  <v-data-table
    :headers="headers"
    :items="connections?.filter((c) => c.title_id == title.id) ?? []"
    :sort-by="sortBy"
    density="comfortable"
    mobile-breakpoint="xs"
    hide-default-footer
    class="bg-transparent"
  >
    <template #item.title="{ item }">
      {{
        store.localized(
          store.profiles.find((p) => p.id === item.profile_id)?.name
        )
      }}
    </template>
    <template #item.network="{ item }">
      <v-chip
        :color="item.network == 'tcp' ? 'green' : 'blue'"
        variant="tonal"
        size="small"
        rounded
      >
        <span class="text-uppercase">
          {{ item.network }}
        </span>
      </v-chip>
    </template>
    <template #item.server="{ item }">
      <CountryFlag
        v-if="item.country_code"
        :country="item.country_code"
        size="small"
      />
      {{ item.destination_ip }}
    </template>
    <template #item.destination="{ item }">
      <div class="d-flex align-center flex-nowrap">
        <CountryFlag
          v-if="store.nodes?.[item.node_id]?.country"
          :country="store.nodes[item.node_id].country"
          size="small"
        />
        <span class="ms-1">
          {{
            store.nodes?.[item.node_id]?.city?.[locale.current.value ?? "en"] ??
            "-"
          }}
        </span>
      </div>
    </template>
    <template #item.download_speed="{ item }">
      <div class="d-flex align-center flex-nowrap">
        <v-icon class="text-secondary"> mdi-arrow-up </v-icon>
        <span class="text-no-wrap me-2">
          {{ useHumanSpeed(item.upload_speed || 0) }}
        </span>
        <v-icon class="text-secondary"> mdi-arrow-down </v-icon>
        <span class="text-no-wrap">
          {{ useHumanSpeed(item.download_speed || 0) }}
        </span>
      </div>
    </template>
    <template #item.latency="{ item }">
      <div class="d-flex align-center flex-nowrap">
        <Ping :tag="item.relay_route?.tag" />
      </div>
    </template>
    <template #item.action="{ item }">
      <v-btn variant="text" color="error" size="small" icon="mdi-cancel" />
    </template>
  </v-data-table>
</template>
