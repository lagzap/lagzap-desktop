<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import Ping from "~/components/network/Ping.vue";
import RelayServerCell from "~/components/network/RelayServerCell.vue";
import { connectionRelayLatency } from "~/composables/useProfileDisplayRoutes";
import { useProfileViewInterface } from "~/composables/useProfileViewInterface";
import { useHumanSpeed } from "~/composables/helper";
import { useLocale } from "vuetify";
import { localDigits } from "~/utils/localeFormat";

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

/** Every connection of the profile, busiest first. */
const allConnections = computed(() =>
  (connections.value ?? [])
    .filter((connection) => connection.profile_id === props.profileId)
    .sort((a, b) => (connectionTraffic(a) > connectionTraffic(b) ? -1 : 1))
);

// The top few show; "Show more" lists them all. The connection picked for
// the chart always stays in view.
const expanded = ref(false);
const collapsedCount = computed(() => props.limit ?? 3);
const profileConnections = computed(() => {
  if (expanded.value) return allConnections.value;
  const top = allConnections.value.slice(0, collapsedCount.value);
  const picked = allConnections.value.find((c) => c.id === selectedConnectionId.value);
  return picked && !top.includes(picked) ? [...top, picked] : top;
});
const hiddenCount = computed(() => allConnections.value.length - profileConnections.value.length);
const canCollapse = computed(() => expanded.value && allConnections.value.length > collapsedCount.value);
// Nothing more to show: back to the short list.
watch(
  () => allConnections.value.length,
  (n) => {
    if (n <= collapsedCount.value) expanded.value = false;
  }
);

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
        <th>{{ t("$vuetify.connections.lagzapServer") }}</th>
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
          <NetworkLabel :network="connection.network" />
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
      <tr v-if="hiddenCount > 0 || canCollapse" class="profile-connections-table__more">
        <td colspan="6">
          <button type="button" class="profile-connections-table__more-btn" @click="expanded = !expanded">
            {{
              expanded
                ? t("$vuetify.connections.showLess")
                : t("$vuetify.connections.showMore", localDigits(hiddenCount))
            }}
            <v-icon :icon="expanded ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="16" />
          </button>
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

/* "Show more" spans the table: a quiet text button, centred. */
.profile-connections-table__more td {
  text-align: center;
  padding: 0 !important;
  height: 32px !important;
}

.profile-connections-table__more-btn {
  width: 100%;
  height: 100%;
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
  transition: color 0.15s, background-color 0.15s;
}

.profile-connections-table__more-btn:hover,
.profile-connections-table__more-btn:focus-visible {
  color: rgba(var(--v-theme-on-surface), 0.87);
  background: rgba(var(--v-theme-on-surface), 0.04);
}

/* Clicking a row must not leave a focus ring; keyboard focus still shows. */
.profile-connections-table__row:focus:not(:focus-visible) {
  outline: none;
}
</style>
