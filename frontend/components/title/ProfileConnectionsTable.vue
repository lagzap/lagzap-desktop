<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import Ping from "~/components/network/Ping.vue";
import RelayServerCell from "~/components/network/RelayServerCell.vue";
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
        <th class="col-network" />
        <th>{{ t("$vuetify.connections.gameServer") }}</th>
        <th>{{ t("$vuetify.connections.cyrexServer") }}</th>
        <th class="text-center col-latency">{{ t("$vuetify.connections.latency") }}</th>
        <th class="col-speed">{{ t("$vuetify.connections.download") }}</th>
        <th class="col-speed">{{ t("$vuetify.connections.upload") }}</th>
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
        <!-- Same transport tag as the Connections page. -->
        <td class="col-network">
          <v-chip
            :color="connection.network == 'tcp' ? 'green' : 'blue'"
            size="x-small"
            variant="tonal"
            rounded
          >
            <span class="text-uppercase">{{ connection.network }}</span>
          </v-chip>
        </td>
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
          <RelayServerCell :connection="connection" />
        </td>
        <td class="text-center text-no-wrap col-latency">
          <Ping
            :tag="connection.relay_route?.tag"
            :latency-ms="connectionRelayLatency(connection)"
          />
        </td>
        <td class="text-no-wrap col-speed">
          <span class="text-caption">
            {{ useHumanSpeed(connection.download_speed || 0) }}
          </span>
        </td>
        <td class="text-no-wrap col-speed">
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

/* Fixed widths + tabular digits so live speeds don't reflow the table. */
.col-speed,
.col-latency {
  font-variant-numeric: tabular-nums;
}

.col-network {
  width: 56px;
  padding-inline-end: 0 !important;
}

.col-speed {
  width: 112px;
  min-width: 112px;
  max-width: 112px;
}

.col-latency {
  width: 88px;
  min-width: 88px;
  max-width: 88px;
}

.profile-connections-table__row {
  cursor: pointer;
}

.profile-connections-table__row--selected {
  background: rgba(var(--v-theme-primary), 0.12);
}

/* One accent on the row's leading edge, not one per cell. */
.profile-connections-table__row--selected td:first-child {
  box-shadow: inset 3px 0 0 rgb(var(--v-theme-primary));
}

.v-locale--is-rtl .profile-connections-table__row--selected td:first-child {
  box-shadow: inset -3px 0 0 rgb(var(--v-theme-primary));
}

/* Clicking a row must not leave a focus ring; keyboard focus still shows. */
.profile-connections-table__row:focus:not(:focus-visible) {
  outline: none;
}
</style>
