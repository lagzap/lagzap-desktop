<script setup lang="ts">
import type { VDataTable, VDataTableVirtual } from "vuetify/components";
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import { sum } from "es-toolkit";
import { useLocale, type DataTableHeader } from "vuetify";

const store = useStore();
const locale = useLocale();
const { t } = locale;
const { connections } = useMonitoringStore();
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
    title: t("$vuetify.connections.lagzapServer"),
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
    minWidth: "250px",
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
        class="bg-transparent h-100"
      >
        <template #item.title="{ item }">
          {{
            store.profiles.find((p) => p.id === item.profile_id)?.name?.en ??
            "-"
          }}
        </template>
        <template #item.server="{ item }">
          <CountryFlag
            v-if="item.country_code"
            :country="item.country_code"
            size="small"
          />
          {{ item.destination_ip }}
        </template>
        <template #item.host="{ item }">
          {{ item.host }}
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
              {{
                store.nodes?.[item.node_id]?.city?.[
                  locale.current.value ?? "en"
                ] ?? "-"
              }}
            </span>
          </div>
        </template>
        <template #item.download_speed="{ item }">
          <div class="d-flex flex-column">
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
            <div class="d-flex align-center flex-nowrap">
              <v-icon class="text-secondary"> mdi-arrow-up </v-icon>
              <span class="text-no-wrap me-2">
                {{ useHumanSpeed(item.upload || 0) }}
              </span>
              <v-icon class="text-secondary"> mdi-arrow-down </v-icon>
              <span class="text-no-wrap">
                {{ useHumanSpeed(item.download || 0) }}
              </span>
            </div>
          </div>
        </template>
        <template #item.latency="{ item }">
          <div class="d-flex align-center flex-nowrap">
            {{ item.ping_avg_latency }}
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
                  store.findTitleByRuleTag?.(item.items[0].raw.rule)?.icon_url
                "
                size="x-small"
              />
            </td>
            <td>
              {{
                store.titles.find((t) => t.id === item.items[0].raw.title_id)
                  ?.name?.en ?? "-"
              }}
            </td>
            <td>
              <div class="d-flex align-center">
                <CountryFlag
                  :country="item.items[0].raw.country_code ?? 'XX'"
                  size="small"
                />
                <span class="ms-1">
                  {{ item.items[0].raw.destination_ip }}:{{
                    item.items[0].raw.destination_port
                  }}
                </span>
              </div>
            </td>
            <td>
              <div class="d-flex align-center">
                <CountryFlag
                  v-if="store.nodes?.[item.items[0].raw.node_id]?.country"
                  :country="store.nodes[item.items[0].raw.node_id].country"
                  size="small"
                />
                <span class="ms-1">
                  {{
                    store.nodes?.[item.items[0].raw.node_id]?.city?.[
                      locale.current.value ?? "en"
                    ] ?? "-"
                  }}
                </span>
              </div>
            </td>
            <td>
              <div class="d-flex align-center flex-nowrap">
                <Ping :tag="item.items[0].raw.relay_route?.tag" />
              </div>
            </td>
            <td>
              <div class="d-flex align-center flex-nowrap">
                <v-icon class="text-secondary"> mdi-arrow-up </v-icon>
                <span class="text-no-wrap me-2">{{
                  useHumanSpeed(
                    sum(item.items.map((x) => x.raw.upload_speed || 0))
                  )
                }}</span>
                <v-icon class="text-secondary"> mdi-arrow-down </v-icon>
                <span class="text-no-wrap">{{
                  useHumanSpeed(
                    sum(item.items.map((x) => x.raw.download_speed || 0))
                  )
                }}</span>
              </div>
            </td>
          </tr>
        </template>
      </v-data-table-virtual>
    </Container>
  </div>
</template>
