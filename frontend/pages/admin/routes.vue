<script setup lang="ts">
import type { VDataTableVirtual } from "vuetify/components";
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import { useLocale, type DataTableHeader } from "vuetify";
import { useMonitoringStore } from "~/stores/monitoring";
import { useHumanSize, useHumanSpeed } from "~/composables/helper";

const { t } = useLocale();
const { routes, connections } = useMonitoringStore();

const items = computed(
  () =>
    routes.value?.routes?.sort((a, b) =>
      a.last_update > b.last_update ? -1 : 1
    ) ?? []
);

const getConnectionsForRoute = (routeTag: string) => {
  return (
    connections.value?.filter(
      (conn) =>
        conn.relay_route?.tag === routeTag ||
        conn.node_id === routeTag.split("-")[0]
    ) ?? []
  );
};

const search = ref<string>("");
const headers = computed<DataTableHeader[]>(() => {
  return [
    {
      title: "Route Tag",
      key: "route_tag",
      align: "start" as const,
      nowrap: true,
      width: "200px",
    },
    {
      title: "Country",
      key: "country",
      align: "center" as const,
      nowrap: true,
      width: "100px",
    },
    {
      title: "Region",
      key: "region",
      align: "start" as const,
      nowrap: true,
      width: "120px",
    },
    {
      title: "City",
      key: "city",
      align: "start" as const,
      nowrap: true,
      width: "120px",
    },
    {
      title: "Node",
      key: "node_name",
      align: "start" as const,
      nowrap: true,
      width: "150px",
    },
    {
      title: "Address",
      key: "address",
      align: "start" as const,
      nowrap: true,
      width: "150px",
    },
    {
      title: "Connections",
      key: "connections",
      align: "center" as const,
      nowrap: true,
      width: "100px",
    },
    {
      title: "Latency",
      key: "avg_latency",
      align: "center" as const,
      nowrap: true,
      width: "100px",
    },
    {
      title: "Packet Loss",
      key: "packet_loss",
      align: "center" as const,
      nowrap: true,
      width: "120px",
    },
    {
      title: "Score",
      key: "score",
      align: "center" as const,
      nowrap: true,
      width: "80px",
    },
    {
      title: "Status",
      key: "status",
      align: "center" as const,
      nowrap: true,
      width: "100px",
    },
    {
      title: "Last Update",
      key: "last_update",
      align: "center" as const,
      nowrap: true,
      width: "120px",
    },
  ];
});

const formatLatency = (latency: number) => {
  if (latency <= 0) return "-";
  return `${latency.toFixed(1)}ms`;
};

const formatPacketLoss = (loss: number) => {
  if (loss <= 0) return "-";
  return `${loss.toFixed(2)}%`;
};

const formatScore = (score: number) => {
  if (score <= 0) return "-";
  return score.toString();
};

const getStatusColor = (status: string) => {
  switch (status.toLowerCase()) {
    case "watching":
      return "success";
    case "active":
      return "primary";
    default:
      return "default";
  }
};

const connectionHeaders = computed<DataTableHeader[]>(() => {
  return [
    {
      title: "Process",
      key: "process",
      align: "start" as const,
      nowrap: true,
      width: "200px",
    },
    {
      title: "Network",
      key: "network",
      align: "center" as const,
      nowrap: true,
      width: "80px",
    },
    {
      title: "Source",
      key: "source",
      align: "start" as const,
      nowrap: true,
      width: "150px",
    },
    {
      title: "Destination",
      key: "destination",
      align: "start" as const,
      nowrap: true,
      width: "150px",
    },
    {
      title: "Host",
      key: "host",
      align: "start" as const,
      nowrap: true,
      width: "200px",
    },
    {
      title: "Usage",
      key: "usage",
      align: "center" as const,
      nowrap: true,
      width: "100px",
    },
    {
      title: "Speed",
      key: "speed",
      align: "center" as const,
      nowrap: true,
      width: "100px",
    },
    {
      title: "Start",
      key: "start",
      align: "center" as const,
      nowrap: true,
      width: "100px",
    },
  ];
});
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          Route Monitoring
        </v-app-bar-title>
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
        <v-chip
          v-if="routes?.total_routes"
          color="primary"
          variant="outlined"
          size="small"
        >
          {{ routes.total_routes }} Active Routes
        </v-chip>
      </v-toolbar>
      <v-data-table-virtual
        :search
        :headers
        :items
        item-key="route_tag"
        density="compact"
        multi-sort
        fixed-header
        hide-default-footer
        :height="$vuetify.display.height - 120"
        class="bg-transparent"
        show-expand
        single-expand
      >
        <template v-slot:item.route_tag="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <v-icon size="small" class="me-1">mdi-route</v-icon>
            <span class="text-caption font-mono">{{ item.route_tag }}</span>
          </div>
        </template>

        <template v-slot:item.country="{ item }">
          <div class="d-flex align-center justify-center">
            <CountryFlag
              v-if="item.country"
              :country="item.country"
              size="small"
            />
            <span v-else class="text-grey">-</span>
          </div>
        </template>

        <template v-slot:item.region="{ item }">
          <span v-if="item.region" class="text-body-2">{{ item.region }}</span>
          <span v-else class="text-grey">-</span>
        </template>

        <template v-slot:item.city="{ item }">
          <span v-if="item.city" class="text-body-2">{{ item.city }}</span>
          <span v-else class="text-grey">-</span>
        </template>

        <template v-slot:item.node_name="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <v-icon size="small" class="me-1">mdi-server</v-icon>
            <div>
              <div class="text-body-2">
                {{ item.node_name || item.node_id }}
              </div>
              <div
                v-if="item.node_name && item.node_id"
                class="text-caption text-grey"
              >
                {{ item.node_id }}
              </div>
            </div>
          </div>
        </template>

        <template v-slot:item.address="{ item }">
          <span class="text-body-2 font-mono">{{ item.address }}</span>
        </template>

        <template v-slot:item.connections="{ item }">
          <v-chip
            :color="item.connections > 0 ? 'success' : 'default'"
            variant="outlined"
            size="small"
          >
            {{ item.connections }}
          </v-chip>
        </template>

        <template v-slot:item.avg_latency="{ item }">
          <span class="text-body-2">{{ formatLatency(item.avg_latency) }}</span>
        </template>

        <template v-slot:item.packet_loss="{ item }">
          <span
            class="text-body-2"
            :class="
              item.packet_loss > 5
                ? 'text-error'
                : item.packet_loss > 1
                ? 'text-warning'
                : 'text-success'
            "
          >
            {{ formatPacketLoss(item.packet_loss) }}
          </span>
        </template>

        <template v-slot:item.score="{ item }">
          <v-chip
            :color="
              item.score >= 80
                ? 'success'
                : item.score >= 60
                ? 'warning'
                : 'error'
            "
            variant="outlined"
            size="small"
          >
            {{ formatScore(item.score) }}
          </v-chip>
        </template>

        <template v-slot:item.status="{ item }">
          <v-chip
            :color="getStatusColor(item.status)"
            variant="outlined"
            size="small"
          >
            <v-icon size="small" class="me-1">mdi-eye</v-icon>
            {{ item.status }}
          </v-chip>
        </template>

        <template v-slot:item.last_update="{ item }">
          <span class="text-body-2">
            {{ new Date(item.last_update).toLocaleTimeString() }}
          </span>
        </template>

        <template v-slot:expanded-row="{ item }">
          <tr>
            <td :colspan="headers.length" class="pa-0">
              <v-card variant="flat" class="ma-2">
                <v-card-title class="d-flex align-center">
                  <v-icon class="me-2">mdi-connection</v-icon>
                  <span>Connections for {{ item.route_tag }}</span>
                  <v-spacer />
                  <v-chip
                    :color="
                      getConnectionsForRoute(item.route_tag).length > 0
                        ? 'success'
                        : 'default'
                    "
                    variant="outlined"
                    size="small"
                  >
                    {{
                      getConnectionsForRoute(item.route_tag).length
                    }}
                    connections
                  </v-chip>
                </v-card-title>

                <v-card-text>
                  <v-data-table-virtual
                    v-if="getConnectionsForRoute(item.route_tag).length > 0"
                    :headers="connectionHeaders"
                    :items="getConnectionsForRoute(item.route_tag)"
                    density="compact"
                    hide-default-footer
                    class="bg-transparent"
                    :height="
                      Math.min(
                        getConnectionsForRoute(item.route_tag).length * 40 + 60,
                        300
                      )
                    "
                  >
                    <template v-slot:item.process="{ item: conn }">
                      <span class="text-body-2">{{ conn.process || "-" }}</span>
                    </template>

                    <template v-slot:item.network="{ item: conn }">
                      <v-chip
                        :color="conn.network === 'tcp' ? 'success' : 'primary'"
                        variant="outlined"
                        size="small"
                      >
                        {{ conn.network?.toUpperCase() }}
                      </v-chip>
                    </template>

                    <template v-slot:item.source="{ item: conn }">
                      <span class="text-body-2 font-mono"
                        >{{ conn.source_ip }}:{{ conn.source_port }}</span
                      >
                    </template>

                    <template v-slot:item.destination="{ item: conn }">
                      <div class="d-flex align-center flex-nowrap">
                        <CountryFlag
                          v-if="conn.country_code"
                          :country="conn.country_code"
                          size="small"
                        />
                        <span class="text-body-2 font-mono ms-1"
                          >{{ conn.destination_ip }}:{{
                            conn.destination_port
                          }}</span
                        >
                      </div>
                    </template>

                    <template v-slot:item.host="{ item: conn }">
                      <span class="text-body-2">{{ conn.host || "-" }}</span>
                    </template>

                    <template v-slot:item.usage="{ item: conn }">
                      <span class="text-body-2">
                        {{
                          useHumanSize(
                            (conn.upload || 0) + (conn.download || 0)
                          )
                        }}
                      </span>
                    </template>

                    <template v-slot:item.speed="{ item: conn }">
                      <span class="text-body-2">
                        {{
                          useHumanSpeed(
                            (conn.upload_speed || 0) +
                              (conn.download_speed || 0)
                          )
                        }}
                      </span>
                    </template>

                    <template v-slot:item.start="{ item: conn }">
                      <span class="text-body-2">
                        {{ new Date(conn.start).toLocaleTimeString() }}
                      </span>
                    </template>
                  </v-data-table-virtual>

                  <div v-else class="text-center py-4 text-grey">
                    <v-icon class="me-2">mdi-information</v-icon>
                    No connections found for this route
                  </div>
                </v-card-text>
              </v-card>
            </td>
          </tr>
        </template>
      </v-data-table-virtual>
    </Container>
  </div>
</template>
