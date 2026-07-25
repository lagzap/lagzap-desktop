<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import Ping from "~/components/network/Ping.vue";
import { connectionRelayLatency } from "~/composables/useProfileDisplayRoutes";
import { useProfileViewInterface } from "~/composables/useProfileViewInterface";
import { useHumanSpeed } from "~/composables/helper";
import { useLocale } from "vuetify";

const props = defineProps<{
  profileId: string;
  limit?: number;
}>();

const store = useStore();
const locale = useLocale();
const { t } = locale;
const { connections } = useMonitoringStore();
const { getNodeLabel } = useNodeLocationLabel();
const { selectedConnectionId, toggleConnectionForChart } =
  useProfileViewInterface(props.profileId);

function connectionTraffic(connection: {
  download?: number;
  upload?: number;
  download_speed?: number;
  upload_speed?: number;
}) {
  const usage =
    Math.abs(connection.download || 0) + Math.abs(connection.upload || 0);
  if (usage > 0) {
    return usage;
  }
  return (
    Math.abs(connection.download_speed || 0) +
    Math.abs(connection.upload_speed || 0)
  );
}

const profileConnections = computed(() => {
  const max = props.limit ?? 5;

  return (connections.value ?? [])
    .filter((connection) => connection.profile_id === props.profileId)
    .sort((a, b) =>
      connectionTraffic(a) > connectionTraffic(b) ? -1 : 1
    )
    .slice(0, max);
});

function nodeCity(nodeId?: string | null) {
  return getNodeLabel(nodeId);
}

function onRowClick(connectionId: string) {
  toggleConnectionForChart(connectionId);
}
</script>

<template>
  <v-table
    v-if="profileConnections.length > 0"
    density="compact"
    class="profile-connections-table bg-transparent"
    hover
  >
    <thead>
      <tr>
        <th>{{ t("$vuetify.connections.gameServer") }}</th>
        <th>{{ t("$vuetify.connections.cyrexServer") }}</th>
        <th class="text-center">{{ t("$vuetify.connections.latency") }}</th>
        <th>{{ t("$vuetify.connections.download") }}</th>
        <th>{{ t("$vuetify.connections.upload") }}</th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="connection in profileConnections"
        :key="connection.id"
        class="profile-connections-table__row"
        :class="{
          'profile-connections-table__row--selected':
            selectedConnectionId === connection.id,
        }"
        :title="t('$vuetify.connections.showOnLatencyChart')"
        tabindex="0"
        role="button"
        @click="onRowClick(connection.id)"
        @keydown.enter.prevent="onRowClick(connection.id)"
        @keydown.space.prevent="onRowClick(connection.id)"
      >
        <td class="text-no-wrap">
          <div class="d-flex align-center">
            <CountryFlag
              :country="connection.country_code ?? 'XX'"
              size="small"
            />
            <span class="text-caption ms-1">
              {{ connection.destination_ip }}:{{ connection.destination_port }}
            </span>
          </div>
        </td>
        <td class="text-no-wrap">
          <div class="d-flex align-center">
            <CountryFlag
              v-if="store.nodes?.[connection.node_id ?? '']?.country"
              :country="store.nodes[connection.node_id ?? ''].country"
              size="small"
            />
            <span class="text-caption ms-1">{{ nodeCity(connection.node_id) }}</span>
          </div>
        </td>
        <td class="text-center text-no-wrap">
          <Ping
            :tag="connection.relay_route?.tag"
            :latency-ms="connectionRelayLatency(connection)"
          />
        </td>
        <td class="text-no-wrap">
          <span class="text-caption">
            {{ useHumanSpeed(connection.download_speed || 0) }}
          </span>
        </td>
        <td class="text-no-wrap">
          <span class="text-caption">
            {{ useHumanSpeed(connection.upload_speed || 0) }}
          </span>
        </td>
      </tr>
    </tbody>
  </v-table>
</template>

<style scoped>
.profile-connections-table :deep(th) {
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}

.profile-connections-table :deep(td) {
  vertical-align: middle;
}

.profile-connections-table__row {
  cursor: pointer;
}

.profile-connections-table__row--selected {
  background: rgba(var(--v-theme-primary), 0.12);
}

.profile-connections-table__row--selected td {
  box-shadow: inset 3px 0 0 rgb(var(--v-theme-primary));
}
</style>
