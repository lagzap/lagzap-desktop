<script setup lang="ts">
import type { VDataTable, VDataTableVirtual } from "vuetify/components";
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import { connectionRelayLatency } from "~/composables/useProfileDisplayRoutes";
import { sum } from "es-toolkit";
import { useLocale, type DataTableHeader } from "vuetify";

const store = useStore();
const locale = useLocale();
const { t } = locale;
const { connections } = useMonitoringStore();
const { getNodeLabel } = useNodeLocationLabel();
const items = computed(
  () =>
    connections.value
      ?.filter((c) => c.profile_id != "")
      .sort((a, b) =>
        a.download_speed + a.upload_speed > b.download_speed + b.upload_speed
          ? -1
          : 1
      )
      .sort((a, b) => (a.start > b.start ? -1 : 1)) ?? []
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
    title: t("$vuetify.connections.gameServer"),
    key: "server",
    sortable: false,
    nowrap: true,
  },
  {
    title: t("$vuetify.connections.cyrexServer"),
    key: "destination",
    sortable: false,
    nowrap: true,
  },
  {
    title: t("$vuetify.connections.latency"),
    key: "latency",
    align: "center",
    sortable: false,
    nowrap: true,
    minWidth: "100px",
  },
  {
    title: t("$vuetify.connections.download"),
    key: "download_speed",
    sortable: true,
    nowrap: true,
    minWidth: "100px",
  },
  {
    title: t("$vuetify.connections.upload"),
    key: "upload_speed",
    sortable: true,
    nowrap: true,
    minWidth: "100px",
  },
]);

const sortBy = ref<VDataTable["sortBy"]>([
  { key: "metadata.network", order: "desc" },
  { key: "download_speed", order: "desc" },
]);
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          {{ t("$vuetify.connections.connections") }}
        </v-app-bar-title>
      </template>
      <v-data-table-virtual
        :headers
        :items
        :sort-by
        :group-by="[
          {
            key: 'title_id',
            order: 'desc',
          },
        ]"
        density="comfortable"
        :mobile="false"
        :height="$vuetify.display.height - 120"
        fixed-header
        hide-default-footer
        class="bg-transparent h-100 mt-1"
      >
        <template #item.title="{ item }">
          <span class="text-caption">
            {{
              store.profiles.find((p) => p.id === item.profile_id)?.name?.en ??
              "-"
            }}
          </span>
        </template>
        <template #item.server="{ item }">
          <v-tooltip>
            <template #activator>
              <div>
                <CountryFlag
                  v-if="item.country_code"
                  :country="item.country_code"
                  size="small"
                />
                <span class="text-caption ms-1">
                  {{ item.destination_ip }}
                </span>
              </div>
              <div>
                {{ item.host }}
              </div>
            </template>
          </v-tooltip>
        </template>
        <template #item.destination_ip="{ item }">
          {{ item.relay_route?.addr }}
        </template>
        <template #item.destination="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <CountryFlag
              v-if="store.nodes?.[item.node_id]?.country"
              :country="store.nodes[item.node_id].country"
              size="small"
            />
            <span class="ms-1">
              {{ getNodeLabel(item.node_id) }}
            </span>
          </div>
        </template>
        <template #item.download_speed="{ item }">
          <div>
            <div class="text-no-wrap text-caption">
              {{ useHumanSpeed(item.download_speed || 0) }}
            </div>
            <div class="text-no-wrap text-caption me-2">
              {{ useHumanSize(item.download || 0) }}
            </div>
          </div>
        </template>
        <template #item.upload_speed="{ item }">
          <div>
            <div class="text-no-wrap text-caption">
              {{ useHumanSpeed(item.upload_speed || 0) }}
            </div>
            <div class="text-no-wrap text-caption me-2">
              {{ useHumanSize(item.upload || 0) }}
            </div>
          </div>
        </template>
        <template #item.latency="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <Ping
              :tag="item.relay_route?.tag"
              :latency-ms="connectionRelayLatency(item)"
            />
          </div>
        </template>
        <template #header.data-table-group />
        <template #item.data-table-group="{ item }">
          <v-chip
            :color="item.network == 'tcp' ? 'green' : 'blue'"
            size="x-small"
            variant="tonal"
            rounded
          >
            <span class="text-uppercase">
              {{ item.network }}
            </span>
          </v-chip>
        </template>
        <template #group-header="{ item, toggleGroup }">
          <tr v-ripple class="cursor-pointer bg" @click="toggleGroup(item)">
            <td>
              <v-avatar
                :image="
                  store.findTitleByRuleTag?.(item.items[0].raw.profile_id)
                    ?.icon_url
                "
                size="x-small"
              />
            </td>
            <td class="text-no-wrap">
              {{
                store.titles.find((t) => t.id === item.items[0].raw.title_id)
                  ?.name?.en ?? "-"
              }}
            </td>
            <td class="text-no-wrap">
              <div class="d-flex align-center">
                <CountryFlag
                  :country="item.items[0].raw.country_code ?? 'XX'"
                  size="small"
                />
                <span class="text-caption ms-1">
                  {{ item.items[0].raw.destination_ip }}:{{
                    item.items[0].raw.destination_port
                  }}
                </span>
              </div>
            </td>
            <td class="text-no-wrap">
              <div class="d-flex align-center">
                <CountryFlag
                  v-if="store.nodes?.[item.items[0].raw.node_id]?.country"
                  :country="store.nodes[item.items[0].raw.node_id].country"
                  size="small"
                />
                <span class="text-caption ms-1">
                  {{ getNodeLabel(item.items[0].raw.node_id) }}
                </span>
              </div>
            </td>
            <td class="text-no-wrap">
              <div class="d-flex align-center flex-nowrap">
                <Ping
                  :tag="item.items[0].raw.relay_route?.tag"
                  :latency-ms="connectionRelayLatency(item.items[0].raw)"
                />
              </div>
            </td>
            <td class="text-no-wrap">
              <span class="text-caption text-no-wrap me-2">
                {{
                  useHumanSpeed(
                    sum(item.items.map((x) => x.raw.download_speed || 0))
                  )
                }}
              </span>
            </td>
            <td class="text-no-wrap">
              <span class="text-caption text-no-wrap">
                {{
                  useHumanSpeed(
                    sum(item.items.map((x) => x.raw.upload_speed || 0))
                  )
                }}
              </span>
            </td>
          </tr>
        </template>
      </v-data-table-virtual>
    </Container>
  </div>
</template>
