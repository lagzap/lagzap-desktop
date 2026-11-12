<script setup lang="ts">
import type { VDataTable, VDataTableVirtual } from "vuetify/components";
import Container from "~/components/layout/Container.vue";
import RelayServerCell from "~/components/network/RelayServerCell.vue";
import ConnectionDetailsDialog from "~/components/network/ConnectionDetailsDialog.vue";
import CountryFlag from "vue-country-flag-next";
import { connectionRelayLatency } from "~/composables/useProfileDisplayRoutes";
import { sum } from "es-toolkit";
import { useLocale, type DataTableHeader } from "vuetify";
import { DisconnectProfile, DisconnectTitle } from "~/bindings/github.com/lagzap/lagzap-desktop/service";

const store = useStore();
const locale = useLocale();
const { t } = locale;
const { connections } = useMonitoringStore();
const items = computed(
  () =>
    connections.value
      // Only profile-tagged flows. Untagged side channels (Bnet :443 etc.) that
      // once transferred bytes used to linger here as Title/LagZap/Latency = "-".
      ?.filter((c) => !!c.profile_id)
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

// A row opens its details; the dialog follows the live row by id.
const detailsId = ref<string | null>(null);
const detailsOpen = ref(false);
const detailsConnection = computed(
  () => connections.value?.find((c) => c.id === detailsId.value) ?? null
);
function openDetails(_event: unknown, row: { item: { id: string } }) {
  detailsId.value = row.item.id;
  detailsOpen.value = true;
}
watch(detailsConnection, (c) => {
  if (!c) detailsOpen.value = false;
});

// Right-click menu: a title row opens the title or disconnects it; a
// profile row disconnects that profile. Disconnect always asks first.
const router = useRouter();
/** udp: only UDP traffic, which has no connection to end, so it cannot be
 * disconnected; the menu says so instead of offering Disconnect. */
type MenuTarget = {
  kind: "title" | "profile";
  id: string;
  name: string;
  titleId?: string;
  udp?: boolean;
  /** The connection a profile row is: "Details" opens it like a click. */
  connectionId?: string;
};
const menu = ref<{ open: boolean; x: number; y: number; target: MenuTarget | null }>({
  open: false,
  x: 0,
  y: 0,
  target: null,
});
const titleName = (id?: string | null) => {
  const title = store.titles.find((t) => t.id === id);
  return title ? store.titleName(title.name) : "-";
};
const profileName = (id?: string | null) => {
  const profile = store.profiles.find((p) => p.id === id);
  return profile ? store.titleName(profile.name) : "-";
};
function openMenu(event: MouseEvent, target: MenuTarget) {
  event.preventDefault();
  menu.value = { open: true, x: event.clientX, y: event.clientY, target };
}
const isUdp = (network?: string) => network?.toLowerCase() === "udp";
function openTitleMenu(event: MouseEvent, titleId: string | null | undefined, rows: readonly { raw: { network?: string } }[]) {
  if (!titleId) return;
  const udp = rows.length > 0 && rows.every((row) => isUdp(row.raw.network));
  openMenu(event, { kind: "title", id: titleId, name: titleName(titleId), titleId, udp });
}
const rowProps = ({
  item,
}: {
  item: { id: string; profile_id?: string | null; title_id?: string | null; network?: string };
}) => ({
  class: "cursor-pointer",
  onContextmenu: (event: MouseEvent) => {
    if (!item.profile_id) return;
    openMenu(event, {
      kind: "profile",
      id: item.profile_id,
      name: profileName(item.profile_id),
      titleId: item.title_id ?? undefined,
      udp: isUdp(item.network),
      connectionId: item.id,
    });
  },
});
function showDetails() {
  const id = menu.value.target?.connectionId;
  menu.value.open = false;
  if (id) openDetails(null, { item: { id } });
}
function goToTitle() {
  const id = menu.value.target?.titleId;
  menu.value.open = false;
  if (id) void router.push({ name: "title-id", params: { id } });
}

const confirm = ref<{ open: boolean; target: MenuTarget | null }>({ open: false, target: null });
const cancelBtn = ref<{ $el?: HTMLElement } | null>(null);
/** The title or profile is on, so the menu can turn it off. */
const targetActive = computed(() => {
  const target = menu.value.target;
  if (!target) return false;
  return target.kind === "title" ? store.isTitleActive(target.id) : store.isProfileActive(target.id);
});
async function turnOff() {
  const target = menu.value.target;
  menu.value.open = false;
  if (!target) return;
  try {
    if (target.kind === "title") await store.deactivateTitle(target.id);
    else await store.deactivateProfile(target.id);
  } catch (error) {
    console.warn("Turn off failed:", error);
  }
}

function askDisconnect() {
  confirm.value = { open: true, target: menu.value.target };
  menu.value.open = false;
}
/** Cancel is the default: focused when the dialog opens, so Enter cancels. */
function focusCancel() {
  cancelBtn.value?.$el?.focus();
}
async function doDisconnect() {
  const target = confirm.value.target;
  confirm.value.open = false;
  if (!target) return;
  try {
    if (target.kind === "title") await DisconnectTitle(target.id);
    else await DisconnectProfile(target.id);
  } catch (error) {
    console.warn("Disconnect failed:", error);
  }
}

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
        hover
        :row-props="rowProps"
        class="bg-transparent h-100 mt-1"
        @click:row="openDetails"
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
            </template>
          </v-tooltip>
        </template>
        <template #item.destination_ip="{ item }">
          {{ item.relay_route?.addr }}
        </template>
        <template #item.destination="{ item }">
          <RelayServerCell :connection="item" text-class="" />
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
          <div class="d-flex align-center justify-center flex-nowrap">
            <Ping
              :tag="item.relay_route?.tag"
              :latency-ms="connectionRelayLatency(item)"
            />
          </div>
        </template>
        <template #header.data-table-group />
        <template #item.data-table-group="{ item }">
          <NetworkLabel :network="item.network" />
        </template>
        <template #group-header="{ item, toggleGroup }">
          <tr
            v-ripple
            class="cursor-pointer bg"
            @click="toggleGroup(item)"
            @contextmenu="openTitleMenu($event, item.items[0].raw.title_id, item.items)"
          >
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
              <RelayServerCell :connection="item.items[0].raw" />
            </td>
            <td class="text-no-wrap">
              <div class="d-flex align-center justify-center flex-nowrap">
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
      <ConnectionDetailsDialog v-model="detailsOpen" :connection="detailsConnection" />

      <v-menu
        v-model="menu.open"
        :target="[menu.x, menu.y]"
        location="bottom start"
        min-width="200"
      >
        <v-list density="compact" class="py-1">
          <v-list-item
            v-if="menu.target?.kind === 'title'"
            prepend-icon="mdi-open-in-app"
            :title="t('$vuetify.connections.menu.open', menu.target.name)"
            @click="goToTitle"
          />
          <v-list-item
            v-if="menu.target?.connectionId"
            prepend-icon="mdi-text-box-search-outline"
            :title="t('$vuetify.connections.menu.details')"
            @click="showDetails"
          />
          <v-list-item
            v-if="targetActive"
            prepend-icon="mdi-power"
            :title="t('$vuetify.connections.menu.turnOff', menu.target?.name ?? '')"
            @click="turnOff"
          />
          <v-list-item
            v-if="!menu.target?.udp"
            prepend-icon="mdi-lan-disconnect"
            base-color="error"
            :title="t('$vuetify.connections.menu.disconnect')"
            @click="askDisconnect"
          />
          <v-list-item
            v-else
            prepend-icon="mdi-information-outline"
            :title="t('$vuetify.connections.menu.udpTitle')"
            :subtitle="t('$vuetify.connections.menu.udpText')"
            lines="two"
            class="udp-note"
            max-width="300"
          />
        </v-list>
      </v-menu>

      <v-dialog v-model="confirm.open" max-width="420" @after-enter="focusCancel">
        <v-card rounded="xl">
          <v-card-item>
            <template #prepend>
              <v-avatar color="error" variant="tonal" icon="mdi-lan-disconnect" />
            </template>
            <v-card-title class="text-wrap">
              {{ t("$vuetify.connections.menu.confirmTitle", confirm.target?.name ?? "") }}
            </v-card-title>
          </v-card-item>
          <v-card-text class="text-body-2 text-medium-emphasis">
            {{ t("$vuetify.connections.menu.confirmText") }}
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn ref="cancelBtn" variant="tonal" @click="confirm.open = false">
              {{ t("$vuetify.connections.menu.cancel") }}
            </v-btn>
            <v-btn color="error" variant="text" @click="doDisconnect">
              {{ t("$vuetify.connections.menu.disconnect") }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
    </Container>
  </div>
</template>

<style scoped>
/* The UDP note is information, not an action. */
.udp-note {
  cursor: default;
}

.udp-note :deep(.v-list-item-subtitle) {
  white-space: normal;
  -webkit-line-clamp: unset;
}
</style>
