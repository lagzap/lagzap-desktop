<script setup lang="ts">
import type { VDataTableVirtual } from "vuetify/components";
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import { useLocale, type DataTableHeader } from "vuetify";
import { GetNodes, GetProfiles, GetTitles } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import ConnectionInfo from "~/components/admin/ConnectionInfo.vue";

definePageMeta({
  layout: "admin",
  sanctum: {
    excluded: true,
  },
});

const { t } = useLocale();
const { connections } = useMonitoringStore();
const store = useStore();

// Admin Tools is its own window: it gets title and profile changes as events
// but not the initial lists, so it loads them once.
onMounted(async () => {
  try {
    if (!store.titles.length) store.titles = Object.values(await GetTitles());
    if (!store.profiles.length) store.profiles = Object.values(await GetProfiles());
    if (!Object.keys(store.nodes).length) store.nodes = await GetNodes();
  } catch {
    // service not running yet: connections show without titles
  }
});

const titleById = computed(() => new Map(store.titles.map((title) => [title.id, title])));
const profileById = computed(() => new Map(store.profiles.map((profile) => [profile.id, profile])));

/** "D:\Games\Wow.exe" → "Wow.exe"; the full path stays in the tooltip. */
function processName(path: string | undefined): string {
  return path?.split(/[\\/]/).pop() || path || "";
}

/** The value just copied: its cell shows a check for a moment. */
const copied = ref("");
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copy(value: string | undefined) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    return; // clipboard refused
  }
  copied.value = value;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = ""), 1200);
}

/** A closed connection stays listed, greyed out, this long. */
const CLOSED_KEEP_MS = 60_000;

type Live = NonNullable<typeof connections.value>[number];
/** Connections that left the live list, by id, with when they closed. */
const closed = ref(new Map<string, { connection: Live; closedAt: number }>());
let lastLive = new Map<string, Live>();

watch(
  connections,
  (list) => {
    const live = new Map((list ?? []).map((connection) => [connection.id, connection]));
    const next = new Map(closed.value);
    for (const [id, connection] of lastLive) {
      if (!live.has(id)) next.set(id, { connection, closedAt: Date.now() });
    }
    for (const id of live.keys()) next.delete(id);
    closed.value = next;
    lastLive = live;
  },
  { immediate: true }
);

const pruneTimer = setInterval(() => {
  const cutoff = Date.now() - CLOSED_KEEP_MS;
  if (![...closed.value.values()].some((c) => c.closedAt < cutoff)) return;
  closed.value = new Map([...closed.value].filter(([, c]) => c.closedAt >= cutoff));
}, 5_000);
onUnmounted(() => clearInterval(pruneTimer));

/** Connections with the title and profile they belong to, when LagZap matched one. */
const items = computed(() =>
  [
    ...(connections.value ?? []).map((connection) => ({ connection, closed: false })),
    // A closed connection moves nothing any more.
    ...[...closed.value.values()].map(({ connection }) => ({
      connection: { ...connection, upload_speed: 0, download_speed: 0 },
      closed: true,
    })),
  ]
    .sort((a, b) => (a.connection.start > b.connection.start ? -1 : 1))
    .map(({ connection, closed }) => {
      const profile = connection.profile_id ? profileById.value.get(connection.profile_id) : undefined;
      const title = titleById.value.get(connection.title_id ?? profile?.title_id ?? "");
      // A Dedicated IP tunnel's own connection to the WireGuard server: the
      // only rows whose destination shows a hostname.
      const wireguard = connection.type === "wireguard";
      return {
        ...connection,
        closed,
        wireguard,
        process_name: wireguard ? t("$vuetify.title.profile.wireguard.title") : processName(connection.process),
        title_icon: title?.icon_url ?? "",
        title_name: title ? store.titleName(title.name) : "",
        profile_name: profile ? store.titleName(profile.name) : "",
      };
    })
);

const rowProps = ({ item }: { item: { closed: boolean } }) => (item.closed ? { class: "row-closed" } : {});

/** "2001:db8::1" with a port reads as "[2001:db8::1]". */
function hostForPort(ip: string): string {
  return ip.includes(":") ? `[${ip}]` : ip;
}

const search = ref<string>("");
const headers = computed<DataTableHeader[]>(() => {
  return [
    {
      title: "App",
      key: "process_name",
      align: "start" as const,
      nowrap: true,
      width: "auto",
    },
    {
      title: "Net",
      key: "network",
      align: "center" as const,
      nowrap: true,
      width: "48px",
    },
    {
      title: "Source",
      key: "source",
      align: "start" as const,
      nowrap: true,
      width: "190px",
    },
    {
      title: "Destination",
      key: "destination",
      align: "start" as const,
      nowrap: true,
      width: "210px",
    },
    {
      title: "Host",
      key: "host",
      align: "start" as const,
      nowrap: true,
    },
    {
      title: "Usage",
      key: "download",
      align: "center" as const,
      nowrap: true,
      width: "120px",
    },
    {
      title: "Speed",
      key: "download_speed",
      align: "center" as const,
      nowrap: true,
      width: "120px",
    },
    {
      title: "Start",
      key: "start",
      align: "center" as const,
      nowrap: true,
      width: "0%",
    },
  ];
});
</script>

<template>
  <div>
    <Container>
      <Teleport defer to="#admin-bar-actions">
        <v-text-field
          v-model:model-value="search"
          variant="solo-filled"
          flat
          rounded="xl"
          density="compact"
          :placeholder="t('$vuetify.common.search')"
          prepend-inner-icon="mdi-magnify"
          hide-details
          single-line
          clearable
          style="width: 280px"
        />
      </Teleport>
      <v-data-table-virtual
        :search
        :headers
        :items
        :row-props="rowProps"
        density="compact"
        multi-sort
        fixed-header
        hide-default-footer
        :height="$vuetify.display.height - 64"
        class="bg-transparent"
      >
        <!-- The title's icon tells the game; the process is the name and
             the profile is under it. -->
        <template v-slot:item.process_name="{ item }">
          <div class="d-flex align-center ga-2 py-1">
            <v-tooltip :text="item.title_name || item.process || '-'" location="top" open-delay="300">
              <template #activator="{ props: tip }">
                <v-avatar v-bind="tip" size="24" rounded="sm" variant="tonal">
                  <v-icon v-if="item.wireguard" icon="mdi-tunnel-outline" size="16" />
                  <v-img v-else-if="item.title_icon" :src="item.title_icon" />
                  <v-icon v-else icon="mdi-application-outline" size="16" />
                </v-avatar>
              </template>
            </v-tooltip>
            <div class="title-cell">
              <div class="text-body-2 text-truncate" v-tooltip="item.process">{{ item.process_name || "-" }}</div>
              <div v-if="item.profile_name" class="text-caption text-medium-emphasis text-truncate">
                {{ item.profile_name }}
              </div>
            </div>
            <ConnectionInfo :connection="item" />
          </div>
        </template>
        <template v-slot:item.network="{ item }">
          <NetworkLabel :network="item.network" :protocol="item.protocol" class="net-cell" />
        </template>
        <template v-slot:item.source="{ item }">
          <v-tooltip v-if="item.source_ip" :text="item.source_ip" location="top" open-delay="300">
            <template #activator="{ props: tip }">
              <span v-bind="tip" class="copyable ip-cell" @click.stop="copy(item.source_ip)"><span class="ip-cell__text">{{ item.source_port ? hostForPort(item.source_ip) : item.source_ip }}</span><span v-if="item.source_port" class="port">:{{ item.source_port }}</span><v-icon v-if="copied === item.source_ip" icon="mdi-check" size="14" color="success" class="ms-1" /></span>
            </template>
          </v-tooltip>
          <span v-else class="text-medium-emphasis">-</span>
        </template>
        <template v-slot:item.destination="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <CountryFlag
              v-if="item.country_code"
              :country="item.country_code"
              size="small"
            />
            <span class="ms-1">
              <v-tooltip v-if="item.destination_ip" :text="item.destination_ip" location="top" open-delay="300">
            <template #activator="{ props: tip }">
              <span v-bind="tip" class="copyable ip-cell" @click.stop="copy(item.destination_ip)"><span class="ip-cell__text">{{ item.wireguard && item.host ? item.host : item.destination_port ? hostForPort(item.destination_ip) : item.destination_ip }}</span><span v-if="item.destination_port" class="port">:{{ item.destination_port }}</span><v-icon v-if="copied === item.destination_ip" icon="mdi-check" size="14" color="success" class="ms-1" /></span>
            </template>
          </v-tooltip>
              <span v-else class="text-medium-emphasis">-</span>
            </span>
          </div>
        </template>
        <template v-slot:item.host="{ item }">
          <span v-if="item.host" class="copyable" v-tooltip="'Click to copy'" @click.stop="copy(item.host)">{{ item.host }}<v-icon v-if="copied === item.host" icon="mdi-check" size="14" color="success" class="ms-1" /></span>
          <span v-else class="text-medium-emphasis">-</span>
        </template>
        <template v-slot:item.download_speed="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <span>{{
              useHumanSpeed(
                (item.upload_speed || 0) + (item.download_speed || 0)
              )
            }}</span>
          </div>
        </template>
        <template v-slot:item.download="{ item }">
          <div class="d-flex align-center flex-nowrap">
            <span>{{
              useHumanSize((item.upload || 0) + (item.download || 0))
            }}</span>
          </div>
        </template>
        <template v-slot:item.start="{ item }">
          {{ new Date(item.start).toLocaleTimeString() }}
          <div v-if="item.closed" class="text-caption">Closed</div>
        </template>
      </v-data-table-virtual>
    </Container>
  </div>
</template>

<style scoped>
.copyable {
  cursor: pointer;
  border-radius: 4px;
  transition: color 0.15s ease;
}

.copyable:hover {
  color: rgb(var(--v-theme-primary));
}

/* Long IPv6 addresses are cut short; the tooltip shows the whole one. */
.ip-cell {
  display: inline-flex;
  align-items: center;
  max-width: 180px;
  vertical-align: middle;
}

/* The port after an address, quieter than the address itself. */
.port {
  flex-shrink: 0;
  opacity: 0.5;
}

/* A connection that closed in the last minute: still listed, greyed out. */
:deep(.row-closed) {
  opacity: 0.4;
}

.ip-cell__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.net-cell {
  font-size: 0.5625rem;
  letter-spacing: 0.02em;
}

.title-cell {
  min-width: 0;
  max-width: 220px;
  line-height: 1.2;
}
</style>
