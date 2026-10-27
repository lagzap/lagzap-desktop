<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import { useLocale } from "vuetify";
import CountryFlag from "vue-country-flag-next";
import { GetConnectionDetails } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import RelayServerCell from "~/components/network/RelayServerCell.vue";
import { connectionRelayLatency } from "~/composables/useProfileDisplayRoutes";
import { useNetworkMonitor } from "~/composables/useNetworkMonitor";
import { formatMs, formatSize, formatSpeed, localDigits } from "~/utils/localeFormat";
import type { Connection } from "~/types/monitoring";

/** One Connections row opened up: traffic, latency, and how the profile
 * carries it (Multi Internet legs, active + standby adapter, or one adapter)
 * with each leg's path, ping and loss. Refreshes every second while open. */
interface DiagramHop {
  ip: string;
  node_id: string;
  latency: number;
}
interface Leg {
  route: {
    iface: string;
    network: string;
    hops: DiagramHop[] | null;
    latency: number;
    packet_loss: number;
  };
  backup: boolean;
}
interface Details {
  mode: "multipath" | "failover" | "single";
  legs: Leg[] | null;
}

const props = defineProps<{ connection: Connection | null }>();
const open = defineModel<boolean>({ default: false });

const store = useStore();
const { t } = useLocale();
const { getNodeLabelByIp } = useNodeLocationLabel();
const { colorOf } = useNetworkMonitor();
const details = ref<Details | null>(null);
const now = ref(Date.now());

let timer: ReturnType<typeof setInterval> | undefined;
async function refresh() {
  now.value = Date.now();
  const id = props.connection?.id;
  if (!id) return;
  try {
    details.value = ((await GetConnectionDetails(id)) as Details | null) ?? null;
  } catch {
    details.value = null;
  }
}
function stop() {
  clearInterval(timer);
  timer = undefined;
}
watch(
  () => [open.value, props.connection?.id] as const,
  ([isOpen]) => {
    stop();
    details.value = null;
    if (!isOpen) return;
    void refresh();
    timer = setInterval(refresh, 1000);
  },
  { immediate: true }
);
onUnmounted(stop);

const c = computed(() => props.connection);
const profileName = computed(() => {
  const profile = store.profiles.find((p) => p.id === c.value?.profile_id);
  return profile ? String(store.localized(profile.name) || profile.name?.en || "") : "";
});
const titleName = computed(() => {
  const title = store.titles.find((x) => x.id === c.value?.title_id);
  return title ? store.titleName(title.name) : "";
});
const titleIcon = computed(() => store.findTitleByRuleTag?.(c.value?.profile_id ?? "")?.icon_url);
const processName = computed(() => (c.value?.process ?? "").split(/[\\/]/).pop() ?? "");

function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return localDigits(h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`);
}

const legs = computed(() => details.value?.legs ?? []);
const active = computed(() => legs.value.filter((leg) => !leg.backup));
const standby = computed(() => legs.value.filter((leg) => leg.backup));
const mode = computed(() => details.value?.mode ?? "single");
const modeLabel = computed(() => t(`$vuetify.connections.details.mode.${mode.value}`));
const modeIcon = computed(
  () => ({ multipath: "mdi-call-split", failover: "mdi-shield-sync-outline", single: "mdi-ethernet" })[mode.value]
);

const stats = computed(() => {
  const x = c.value;
  if (!x) return [];
  const loss = active.value.length
    ? Math.min(...active.value.map((leg) => leg.route.packet_loss || 0))
    : x.packet_loss || 0;
  return [
    { label: t("$vuetify.connections.download"), value: formatSpeed(x.download_speed || 0), sub: formatSize(x.download || 0) },
    { label: t("$vuetify.connections.upload"), value: formatSpeed(x.upload_speed || 0), sub: formatSize(x.upload || 0) },
    { label: t("$vuetify.connections.latency"), value: formatMs(connectionRelayLatency(x)), sub: "" },
    { label: t("$vuetify.connections.details.loss"), value: `${localDigits(loss.toFixed(1))}%`, sub: "" },
    { label: t("$vuetify.connections.details.duration"), value: x.start ? duration(now.value - x.start) : "—", sub: "" },
  ];
});

function hopLabel(hop: DiagramHop): string {
  return getNodeLabelByIp(hop.ip) || hop.ip;
}
function legPath(leg: Leg): string {
  return (leg.route.hops ?? []).map(hopLabel).join(" → ");
}
</script>

<template>
  <v-dialog v-model="open" max-width="620" scrollable>
    <v-card v-if="c" rounded="lg" class="connection-details">
      <v-card-title class="d-flex align-center ga-3 pt-4">
        <v-avatar v-if="titleIcon" :image="titleIcon" size="28" />
        <div class="d-flex flex-column min-w-0">
          <span class="text-subtitle-1 font-weight-medium text-truncate">{{ profileName || titleName }}</span>
          <span v-if="titleName && profileName" class="text-caption text-medium-emphasis text-truncate">{{ titleName }}</span>
        </div>
        <v-spacer />
        <v-chip :color="c.network == 'tcp' ? 'green' : 'blue'" size="x-small" variant="tonal" rounded>
          <span class="text-uppercase">{{ c.network }}</span>
        </v-chip>
        <v-btn icon="mdi-close" size="small" variant="text" @click="open = false" />
      </v-card-title>

      <v-card-text class="pt-2">
        <div class="connection-details__stats">
          <div v-for="stat in stats" :key="stat.label" class="connection-details__stat">
            <div class="text-caption text-medium-emphasis">{{ stat.label }}</div>
            <div class="text-subtitle-2 font-weight-medium">{{ stat.value }}</div>
            <div v-if="stat.sub" class="text-caption text-medium-emphasis">{{ stat.sub }}</div>
          </div>
        </div>

        <div class="connection-details__facts mt-4">
          <div class="text-caption text-medium-emphasis">{{ t("$vuetify.connections.gameServer") }}</div>
          <div class="d-flex align-center ga-1 text-body-2">
            <CountryFlag v-if="c.country_code" :country="c.country_code" size="small" />
            <span>{{ c.destination_ip }}:{{ c.destination_port }}</span>
            <span v-if="c.host" class="text-medium-emphasis">· {{ c.host }}</span>
          </div>
          <div class="text-caption text-medium-emphasis">{{ t("$vuetify.connections.cyrexServer") }}</div>
          <RelayServerCell :connection="c" text-class="text-body-2" />
          <template v-if="processName">
            <div class="text-caption text-medium-emphasis">{{ t("$vuetify.connections.details.process") }}</div>
            <div class="text-body-2 text-truncate" :title="c.process">{{ processName }}</div>
          </template>
        </div>

        <v-divider class="my-4" />

        <div class="d-flex align-center ga-2 mb-3">
          <v-icon :icon="modeIcon" size="18" />
          <span class="text-subtitle-2">{{ modeLabel }}</span>
        </div>

        <div v-if="!legs.length" class="text-body-2 text-medium-emphasis">
          {{ t("$vuetify.connections.details.noLegs") }}
        </div>
        <template v-else>
          <div
            v-for="(group, gi) in mode === 'failover'
              ? [
                  { key: 'active', label: t('$vuetify.connections.details.active'), items: active },
                  { key: 'standby', label: t('$vuetify.connections.details.standby'), items: standby },
                ]
              : [{ key: 'legs', label: '', items: active }]"
            :key="group.key"
            :class="{ 'mt-3': gi > 0 }"
          >
            <div v-if="group.label && group.items.length" class="text-caption text-medium-emphasis mb-1">
              {{ group.label }}
            </div>
            <div
              v-for="(leg, i) in group.items"
              :key="`${leg.route.iface}|${leg.route.network}|${i}`"
              class="connection-details__leg"
              :class="{ 'connection-details__leg--standby': leg.backup }"
              :style="{ '--leg-color': colorOf(leg.route.iface) }"
            >
              <div class="d-flex align-center ga-2">
                <span class="text-body-2 font-weight-medium">{{ leg.route.iface || "—" }}</span>
                <v-chip :color="leg.route.network == 'tcp' ? 'green' : 'blue'" size="x-small" variant="tonal" rounded>
                  <span class="text-uppercase">{{ leg.route.network }}</span>
                </v-chip>
                <v-spacer />
                <span class="text-body-2">{{ formatMs(leg.route.latency > 0 ? leg.route.latency : null) }}</span>
                <span
                  v-if="leg.route.packet_loss > 0"
                  class="text-caption"
                  :class="leg.route.packet_loss >= 5 ? 'text-error' : 'text-warning'"
                >
                  {{ localDigits(leg.route.packet_loss.toFixed(1)) }}%
                </span>
              </div>
              <div class="text-caption text-medium-emphasis text-truncate" :title="legPath(leg)">
                {{ legPath(leg) }}
              </div>
            </div>
          </div>
        </template>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.connection-details__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 8px;
}

.connection-details__stat {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgb(var(--v-theme-on-surface) / 0.04);
}

.connection-details__facts {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 6px 16px;
}

.connection-details__leg {
  padding: 8px 10px 8px 12px;
  border-radius: 8px;
  border-inline-start: 3px solid var(--leg-color);
  background: rgb(var(--v-theme-on-surface) / 0.04);
}

.connection-details__leg + .connection-details__leg {
  margin-top: 6px;
}

.connection-details__leg--standby {
  opacity: 0.65;
}
</style>
