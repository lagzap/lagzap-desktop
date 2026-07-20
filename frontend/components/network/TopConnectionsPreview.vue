<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import Ping from "~/components/network/Ping.vue";
import { connectionRelayLatency } from "~/composables/useProfileDisplayRoutes";
import type { Connection } from "~/types/monitoring";
import { sum } from "es-toolkit";
import { useLocale } from "vuetify";

interface TitlePreviewRow {
  titleId: string;
  iconUrl?: string;
  connection: Connection;
  titleTraffic: number;
}

function connectionTraffic(connection: Connection) {
  return (connection.download_speed || 0) + (connection.upload_speed || 0);
}

function pickTopConnectionForTitle(titleConnections: Connection[]): Connection | null {
  const byProfile = new Map<string, Connection[]>();

  titleConnections.forEach((connection) => {
    const profileId = connection.profile_id ?? "";
    if (!profileId) {
      return;
    }

    const existing = byProfile.get(profileId) ?? [];
    existing.push(connection);
    byProfile.set(profileId, existing);
  });

  let bestProfileConnections: Connection[] = [];
  let bestProfileTraffic = -1;

  byProfile.forEach((profileConnections) => {
    const profileTraffic = sum(profileConnections.map(connectionTraffic));
    if (profileTraffic > bestProfileTraffic) {
      bestProfileTraffic = profileTraffic;
      bestProfileConnections = profileConnections;
    }
  });

  if (bestProfileConnections.length === 0) {
    return null;
  }

  return [...bestProfileConnections].sort((a, b) =>
    connectionTraffic(a) > connectionTraffic(b) ? -1 : 1
  )[0];
}

const store = useStore();
const locale = useLocale();
const { t } = locale;
const router = useRouter();
const { connections } = useMonitoringStore();
const { getNodeLabel } = useNodeLocationLabel();

const connectionGroups = computed(() => {
  const filtered = (connections.value ?? []).filter((c) => c.profile_id !== "");

  const byTitle = new Map<string, Connection[]>();
  filtered.forEach((connection) => {
    const titleId = connection.title_id ?? "";
    if (!titleId) {
      return;
    }

    const existing = byTitle.get(titleId) ?? [];
    existing.push(connection);
    byTitle.set(titleId, existing);
  });

  return [...byTitle.entries()]
    .map(([titleId, titleConnections]) => {
      const connection = pickTopConnectionForTitle(titleConnections);
      if (!connection) {
        return null;
      }

      const byProfile = new Map<string, Connection[]>();
      titleConnections.forEach((item) => {
        const profileId = item.profile_id ?? "";
        if (!profileId) {
          return;
        }
        const existing = byProfile.get(profileId) ?? [];
        existing.push(item);
        byProfile.set(profileId, existing);
      });

      let titleTraffic = 0;
      byProfile.forEach((profileConnections) => {
        const profileTraffic = sum(profileConnections.map(connectionTraffic));
        if (profileTraffic > titleTraffic) {
          titleTraffic = profileTraffic;
        }
      });

      const row: TitlePreviewRow = {
        titleId,
        iconUrl: store.findTitleByRuleTag?.(connection.profile_id ?? "")?.icon_url,
        connection,
        titleTraffic,
      };
      return row;
    })
    .filter((row): row is TitlePreviewRow => row !== null)
    .sort((a, b) => (a.titleTraffic > b.titleTraffic ? -1 : 1))
    .slice(0, 3);
});

function profileName(item: Connection) {
  return (
    store.profiles.find((p) => p.id === item.profile_id)?.name?.en ?? "-"
  );
}

function nodeCity(item: Connection) {
  return getNodeLabel(item.node_id);
}

function goToConnections() {
  router.push({ name: "connections" });
}

const navigateIcon = computed(() =>
  locale.isRtl.value ? "mdi-chevron-left" : "mdi-chevron-right"
);
</script>

<template>
  <v-card flat class="mt-3 bg-transparent">
    <v-card-item class="pb-2 cursor-pointer" @click="goToConnections">
      <v-card-title class="text-subtitle-1">
        {{ t("$vuetify.connections.connections") }}
      </v-card-title>
      <template #append>
        <v-icon
          :icon="navigateIcon"
          size="small"
          class="text-medium-emphasis"
        />
      </template>
    </v-card-item>

    <v-table
      v-if="connectionGroups.length > 0"
      density="compact"
      class="connections-preview-table bg-transparent"
      hover
    >
      <thead>
        <tr>
          <th>{{ t("$vuetify.connections.title") }}</th>
          <th>{{ t("$vuetify.connections.gameServer") }}</th>
          <th>{{ t("$vuetify.connections.cyrexServer") }}</th>
          <th class="text-center">{{ t("$vuetify.connections.latency") }}</th>
          <th>{{ t("$vuetify.connections.download") }}</th>
          <th>{{ t("$vuetify.connections.upload") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="group in connectionGroups"
          :key="group.titleId"
          class="cursor-pointer"
          @click="goToConnections"
        >
          <td class="text-no-wrap">
            <div class="d-flex align-center ga-2">
              <v-avatar size="24" rounded="lg" :image="group.iconUrl" />
              <span class="text-caption">{{ profileName(group.connection) }}</span>
            </div>
          </td>
          <td class="text-no-wrap">
            <div class="d-flex align-center">
              <CountryFlag
                :country="group.connection.country_code ?? 'XX'"
                size="small"
              />
              <span class="text-caption ms-1">
                {{ group.connection.destination_ip }}:{{ group.connection.destination_port }}
              </span>
            </div>
          </td>
          <td class="text-no-wrap">
            <div class="d-flex align-center">
              <CountryFlag
                v-if="store.nodes?.[group.connection.node_id ?? '']?.country"
                :country="store.nodes[group.connection.node_id ?? ''].country"
                size="small"
              />
              <span class="text-caption ms-1">{{ nodeCity(group.connection) }}</span>
            </div>
          </td>
          <td class="text-center text-no-wrap">
            <Ping
              :tag="group.connection.relay_route?.tag"
              :latency-ms="connectionRelayLatency(group.connection)"
            />
          </td>
          <td class="text-no-wrap">
            <span class="text-caption">
              {{ useHumanSpeed(group.connection.download_speed || 0) }}
            </span>
          </td>
          <td class="text-no-wrap">
            <span class="text-caption">
              {{ useHumanSpeed(group.connection.upload_speed || 0) }}
            </span>
          </td>
        </tr>
      </tbody>
    </v-table>

    <v-card-text v-else class="text-center text-medium-emphasis py-6">
      <div class="text-body-2">
        {{ t("$vuetify.connections.connectionsSubtitle", [0]) }}
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}

.connections-preview-table :deep(th) {
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
}

.connections-preview-table :deep(td) {
  vertical-align: middle;
}
</style>
