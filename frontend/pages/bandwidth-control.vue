<script setup lang="ts">
import { useLocale, useTheme } from "vuetify";
import Container from "~/components/layout/Container.vue";
import { chartLineColor, interfaceBaseColor } from "~/composables/useLatencyMetrics";
import { ProfileFlag } from "~/constants/profile";
import HelpTip from "~/components/settings/HelpTip.vue";
import SensitiveText from "~/components/common/SensitiveText.vue";
import AppSparkline, { type SparkSeries } from "~/components/network/bandwidth/AppSparkline.vue";
import AppLimitDialog from "~/components/network/bandwidth/AppLimitDialog.vue";
import AppRouteDialog from "~/components/network/bandwidth/AppRouteDialog.vue";
import AppTunnelDialog from "~/components/network/bandwidth/AppTunnelDialog.vue";
import CountryFlag from "vue-country-flag-next";
import { GetProfileWireGuard } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { WireGuardConfig } from "~/composables/useProfileWireGuard";
import type { AppTunnel } from "~/utils/indexedDB";
import { limitActiveNow, nowMs, routeFor, useBandwidthControl } from "~/composables/useBandwidthControl";
import { untilText } from "~/components/network/bandwidth/until";
import { formatSize, formatSpeed } from "~/utils/localeFormat";
import type { AppTraffic } from "~/bindings/github.com/lagzap/lagzap/adapter";
import type { AppLimit, AppRoute } from "~/utils/indexedDB";

/** Every app's download right now, routed by LagZap or not, and the speed
 * caps the user sets per app, per folder or for the whole PC. Go counts and
 * caps on the NDIS layer; the caps are kept on this PC only. */
const { t, isRtl } = useLocale();
const bc = (key: string, ...params: unknown[]) => t(`$vuetify.bandwidthControl.${key}`, ...params);
const {
  apps,
  gaming,
  running,
  limits,
  routes,
  historyTick,
  historyOf,
  internets,
  linkHistoryOf,
  internetsOf,
  infoOf,
  saveLimit,
  deleteLimit,
  saveRoute,
  deleteRoute,
  tunnels,
  saveTunnel,
  deleteTunnel,
} = useBandwidthControl();
// The page shows at once; its content a frame later (placeholders meanwhile).
const contentReady = useDeferredRender();

const displayName = (path: string, fallback: string) =>
  infoOf(path).name || fallback || bc("unknown");

const limitById = computed(() => new Map(limits.value.map((limit) => [limit.id, limit])));
const pcLimit = computed(() => limits.value.find((limit) => limit.kind === "pc") ?? null);
// The whole-PC cap first, then the routed-profile caps, then apps.
const kindOrder: Record<string, number> = { pc: 0, adapter: 1, high_traffic: 2, profile: 3 };
const sortedLimits = computed(() =>
  [...limits.value].sort((a, b) => (kindOrder[a.kind] ?? 3) - (kindOrder[b.kind] ?? 3)),
);

function capLabel(limit: AppLimit, active: boolean) {
  if (!limit.enabled) return bc("capOff");
  if (limit.kind === "profile" && limit.download <= 0) return bc("neverCapped");
  const speed = formatSpeed(limit.download);
  let label = active || !limit.only_while_gaming ? bc("capped", speed) : bc("capWaiting", speed);
  if (limit.until_restart) label += ` · ${bc("untilRestartShort")}`;
  else if (limit.expires_at) label += ` · ${bc("endsIn", untilText(limit.expires_at, t, nowMs.value))}`;
  return label;
}

const limitActive = (limit: AppLimit) => limitActiveNow(limit);

const store = useStore();
/** A routed profile as "Title · Profile". */
function profileName(id: string) {
  const profile = store.profiles.find((item) => item.id === id);
  if (!profile) return bc("unknown");
  const title = store.titles.find((item) => item.id === profile.title_id);
  const name = store.localized(profile.name);
  return title ? `${store.titleName(title.name)} · ${name}` : name;
}

const limitIcon = (limit: AppLimit) =>
  ({
    pc: "mdi-monitor",
    folder: "mdi-folder-outline",
    high_traffic: "mdi-download-network-outline",
    profile: "mdi-download-network-outline",
    adapter: "mdi-lan",
  })[limit.kind];

const limitSubtitle = (limit: AppLimit) =>
  ({ pc: bc("allApps"), high_traffic: bc("highTrafficHint"), adapter: bc("oneInternet") })[limit.kind] ??
  bc("routedProfile");

const limitName = (limit: AppLimit) => {
  if (limit.kind === "pc") return bc("wholePc");
  if (limit.kind === "high_traffic") return bc("highTraffic");
  if (limit.kind === "profile") return profileName(limit.path);
  if (limit.kind === "adapter") return limit.path;
  const base = limit.path.split(/[\\/]/).filter(Boolean).pop() ?? limit.path;
  return limit.kind === "folder" ? base : displayName(limit.path, base);
};

type SortKey = "today" | "speed" | "name";
const sortKey = ref<SortKey>("today");
const sortOptions = computed(() => [
  { value: "today" as SortKey, title: bc("sortToday"), icon: "mdi-sigma" },
  { value: "speed" as SortKey, title: bc("sortSpeed"), icon: "mdi-speedometer" },
  { value: "name" as SortKey, title: bc("sortName"), icon: "mdi-sort-alphabetical-ascending" },
]);
const sortTitle = computed(() => sortOptions.value.find((option) => option.value === sortKey.value)?.title);

const sortedApps = computed(() => {
  const list = [...apps.value];
  const byName = (a: AppTraffic, b: AppTraffic) =>
    displayName(a.path, a.name).localeCompare(displayName(b.path, b.name));
  switch (sortKey.value) {
    case "name":
      return list.sort(byName);
    case "speed":
      return list.sort((a, b) => b.download_speed - a.download_speed || b.download - a.download || byName(a, b));
    default:
      return list.sort((a, b) => b.today - a.today || b.download - a.download || byName(a, b));
  }
});

// Search in the app list: its name, exe or path.
const searchOpen = ref(false);
const search = ref<string | null>("");
const shownApps = computed(() => {
  const query = (search.value ?? "").trim().toLowerCase();
  if (!query) return sortedApps.value;
  return sortedApps.value.filter((app) =>
    [displayName(app.path, app.name), app.name, app.path].some((text) => text?.toLowerCase().includes(query)),
  );
});
function closeSearch() {
  search.value = "";
  searchOpen.value = false;
}
/** The magnifier is the search box, closed: its pill shows, then widens
 * into the field. */
const searchField = ref<{ focus: () => void } | null>(null);
function openSearch() {
  if (searchOpen.value || !apps.value.length) return;
  searchOpen.value = true;
  nextTick(() => searchField.value?.focus());
}

// One dialog for adding a cap (from a row or the header) or editing one.
const dialog = ref(false);
type FixedKind = "pc" | "adapter" | "high_traffic" | "profile";
const dialogTarget = ref<{ path: string; name: string; limit: AppLimit | null; speed?: number; fixed?: FixedKind }>({
  path: "",
  name: "",
  limit: null,
});

function openForApp(app: AppTraffic) {
  dialogTarget.value = {
    path: app.path,
    name: displayName(app.path, app.name),
    limit: app.rule_id ? limitById.value.get(app.rule_id) ?? null : null,
    speed: app.download_speed,
  };
  dialog.value = true;
}

function openForLimit(limit: AppLimit) {
  const fixed = ["pc", "adapter", "high_traffic", "profile"].includes(limit.kind) ? (limit.kind as FixedKind) : undefined;
  dialogTarget.value = { path: limit.path, name: limitName(limit), limit, fixed };
  dialog.value = true;
}

function openForCustom() {
  dialogTarget.value = { path: "", name: "", limit: null };
  dialog.value = true;
}

function openForPC() {
  dialogTarget.value = { path: "", name: bc("wholePc"), limit: pcLimit.value, fixed: "pc" };
  dialog.value = true;
}

function toggle(limit: AppLimit, enabled: boolean | null) {
  saveLimit({ ...limit, enabled: Boolean(enabled) });
}

// Apps sent through another internet (new connections; open ones stay).
const routeDialog = ref(false);
const routeTarget = ref<{ path: string; name: string; route: AppRoute | null }>({ path: "", name: "", route: null });

/** An app's own rule or its folder's, while on. */
const activeRoute = (path: string) => {
  const route = routeFor(path);
  return route?.enabled ? route : null;
};

const routeName = (route: AppRoute) => {
  const base = route.path.split(/[\\/]/).filter(Boolean).pop() ?? route.path;
  return route.kind === "folder" ? base : displayName(route.path, base);
};

// Apps, folders or the whole PC sent through a Dedicated IP (WireGuard).
const tunnelDialog = ref(false);
const tunnelTarget = ref<{ path: string; name: string; tunnel: AppTunnel | null; wholePc: boolean }>({
  path: "",
  name: "",
  tunnel: null,
  wholePc: false,
});
/** The saved Dedicated IP configs (one list on this PC). */
const wireGuardConfigs = ref<WireGuardConfig[]>([]);
async function loadWireGuardConfigs() {
  try {
    const summary = (await GetProfileWireGuard("")) as { configs?: WireGuardConfig[] };
    wireGuardConfigs.value = summary.configs ?? [];
  } catch {
    wireGuardConfigs.value = [];
  }
}
onMounted(loadWireGuardConfigs);
watch(tunnelDialog, (shown) => !shown && void loadWireGuardConfigs());
const configOf = (id: string) => wireGuardConfigs.value.find((config) => config.id === id) ?? null;

const tunnelName = (tunnel: AppTunnel) => {
  if (tunnel.kind === "pc") return bc("wholePc");
  const base = tunnel.path.split(/[\\/]/).filter(Boolean).pop() ?? tunnel.path;
  return tunnel.kind === "folder" ? base : displayName(tunnel.path, base);
};

function openTunnel(tunnel: AppTunnel | null, wholePc = false) {
  tunnelTarget.value = { path: tunnel?.path ?? "", name: tunnel ? tunnelName(tunnel) : "", tunnel, wholePc };
  tunnelDialog.value = true;
}

function openTunnelForApp(app: AppTraffic) {
  tunnelTarget.value = { path: app.path, name: displayName(app.path, app.name), tunnel: null, wholePc: false };
  tunnelDialog.value = true;
}

/** From the chip: send the rule's apps through config now (turning it on). */
function useConfigFor(tunnel: AppTunnel, id: string) {
  if (tunnel.enabled && tunnel.config_id === id) return;
  saveTunnel({ ...tunnel, config_id: id, enabled: true });
}

// Right-click on an app: the same speed cap and internet actions as its
// buttons, at the cursor.
const contextApp = ref<AppTraffic | null>(null);
const contextAt = ref<[number, number]>([0, 0]);
const contextOpen = ref(false);

function openContext(event: MouseEvent, app: AppTraffic) {
  if (app.routed || app.path.startsWith(":")) return;
  contextApp.value = app;
  contextAt.value = [event.clientX, event.clientY];
  contextOpen.value = true;
}

function openRouteForApp(app: AppTraffic) {
  // A folder's rule is edited from its own row; an app row makes its own.
  const own = routeFor(app.path);
  routeTarget.value = {
    path: app.path,
    name: displayName(app.path, app.name),
    route: own?.kind === "exe" ? own : null,
  };
  routeDialog.value = true;
}

function openRoute(route: AppRoute | null) {
  routeTarget.value = { path: route?.path ?? "", name: route ? routeName(route) : "", route };
  routeDialog.value = true;
}

function toggleRoute(route: AppRoute, enabled: boolean | null) {
  saveRoute({ ...route, enabled: Boolean(enabled) });
}

/** The internets Multi Internet knows, by the name Windows gives them. */
const internetNames = computed(() => [...new Set(store.interfaces.map((iface) => iface.Name).filter(Boolean))]);

/** From the chip: send the rule's apps through name now (turning it on). */
function useInternetFor(route: AppRoute, name: string) {
  if (route.enabled && route.interface === name) return;
  saveRoute({ ...route, interface: name, enabled: true });
}

// Shortcuts from other pages: ?open=cap caps the whole PC, ?open=internet
// sends an app through another internet.
const pageRoute = useRoute();
const router = useRouter();
watch(
  () => pageRoute.query.open,
  (open) => {
    if (open === "cap") {
      openForPC();
    } else if (open === "internet") {
      openRoute(null);
    } else {
      return;
    }
    router.replace({ query: { ...pageRoute.query, open: undefined } });
  },
  { immediate: true },
);

// Each internet keeps the color it has on every other chart in the app.
const theme = useTheme();
const internetOrder = computed(() => [...new Set(store.interfaces.map((iface) => iface.Name).filter(Boolean))]);
const internetColor = (name: string) =>
  interfaceBaseColor(name, Math.max(0, internetOrder.value.indexOf(name)), theme.current.value.dark);

/** Per app: one line per internet its download arrived on (so an app moved
 * to another internet shows it), else its total. */
const sparks = computed(() => {
  void historyTick.value;
  return new Map(
    apps.value.map((app) => {
      const internets = app.routed ? [] : internetsOf(app.path);
      const series: SparkSeries[] = internets.length
        ? internets.map((item) => ({ points: item.points, color: internetColor(item.name) }))
        : [{ points: historyOf(app.path), color: app.limited ? "rgb(var(--v-theme-warning))" : undefined }];
      return [app.path, { series, internets: internets.map((item) => item.name) }];
    }),
  );
});

/** The internets the app lines are drawn in, once for the whole list: each
 * line's color says which internet it is. */
const sparkLegend = computed(() => {
  const used = new Set([...sparks.value.values()].flatMap((spark) => spark.internets));
  return internetOrder.value
    .filter((name) => used.has(name))
    .map((name) => ({ name, color: internetColor(name) }));
});

/** The internets Multi Internet knows, one card each: download now, its
 * last minute, today and this month (LagZap's relays included). */
const internetCards = computed(() => {
  void historyTick.value;
  const byName = new Map(internets.value.map((item) => [item.name, item]));
  const names = internetOrder.value.length ? internetOrder.value : [...byName.keys()];
  return names.map((name) => {
    const item = byName.get(name);
    return {
      name,
      color: internetColor(name),
      speed: item?.download_speed ?? 0,
      today: item?.today ?? 0,
      month: item?.month ?? 0,
      points: linkHistoryOf(name),
      isDefault: store.defaultInterface === name,
    };
  });
});

// Hovering the total's or any internet's chart points them all at that
// second (they end together) and their speeds show it, with no tooltip.
const hoverAgo = ref<number | null>(null);
/** A chart's value hoverAgo points before its newest, else now's. */
const atHover = (points: number[], now: number) =>
  hoverAgo.value == null ? now : Math.max(0, points[points.length - 1 - hoverAgo.value] ?? 0);
const hoverTime = computed(() =>
  hoverAgo.value == null ? "" : formatTimeOfDay(new Date(Date.now() - hoverAgo.value * 1000)),
);

/** One ceiling for every internet card's chart, so they compare at a glance. */
const internetMax = computed(() => Math.max(0, ...internetCards.value.flatMap((card) => card.points)));

const internetIcon = (name: string) => {
  if (/wi-?fi|wlan|wireless/i.test(name)) return "mdi-wifi";
  if (/cell|mobile|wwan|lte|5g/i.test(name)) return "mdi-signal-cellular-3";
  return "mdi-ethernet";
};

/** The whole PC: every internet added up. */
const total = computed(() => {
  const cards = internetCards.value;
  const points = new Array(Math.max(0, ...cards.map((card) => card.points.length))).fill(0);
  for (const card of cards) {
    const offset = points.length - card.points.length;
    card.points.forEach((value, i) => (points[offset + i] += value));
  }
  return {
    speed: cards.reduce((sum, card) => sum + card.speed, 0),
    today: cards.reduce((sum, card) => sum + card.today, 0),
    month: cards.reduce((sum, card) => sum + card.month, 0),
    series: [{ points, color: lineColor.value }] as SparkSeries[],
  };
});

/** The line and bar color: cyan, never the gold primary. */
const lineColor = computed(() => chartLineColor(theme.current.value.dark));

/** Each app's download bar: its speed against the fastest app's now. */
const fastest = computed(() => Math.max(1, ...apps.value.map((app) => app.download_speed)));
const speedShare = (app: AppTraffic) => Math.round((app.download_speed / fastest.value) * 100);

/** "using Wi-Fi, Ethernet 4": the internets the app's download arrived on
 * in the last minute. */
const usingText = (app: AppTraffic) => {
  const names = sparks.value.get(app.path)?.internets ?? [];
  return names.length ? bc("using", names.join(isRtl.value ? "، " : ", ")) : "";
};

/** The profile routing an app now, from LagZap's live connections. */
const { connections } = useMonitoringStore();
const profileByApp = computed(() => {
  const map = new Map<string, string>();
  for (const connection of connections.value ?? []) {
    if (!connection.profile_id || !connection.process) continue;
    const key = connection.process.toLowerCase();
    if (!map.has(key)) map.set(key, connection.profile_id);
  }
  return map;
});
const routedProfile = (app: AppTraffic) => {
  const id = profileByApp.value.get(app.path.toLowerCase());
  return id ? store.profiles.find((profile) => profile.id === id) ?? null : null;
};

/** "Through LagZap": its profile's page, with the popup that controls this
 * app's traffic there: the download cap for a download profile, else the
 * route settings. */
const titleMenu = useTitleMenu();
function openRoutedProfile(app: AppTraffic) {
  const profile = routedProfile(app);
  if (!profile) return;
  const download =
    (profile.flags & ProfileFlag.HIGH_TRAFFIC) !== 0 &&
    (profile.flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET | ProfileFlag.PREVENT_DISCONNECT)) === 0;
  titleMenu.requestProfile(profile.id, download ? "cap" : "settings");
  router.push({ name: "title-id", params: { id: profile.title_id } });
}
</script>


<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          {{ t("$vuetify.navigation.bandwidthControl") }}
          <HelpTip
            class="ms-1"
            :text="bc('description')" />
        </v-app-bar-title>
        <template v-if="running">
          <v-tooltip
            :text="bc('gamingHint')"
            location="bottom"
            open-delay="300">
            <template #activator="{ props: tip }">
              <v-chip
                v-bind="tip"
                :color="gaming ? 'success' : undefined"
                :prepend-icon="gaming ? 'mdi-controller' : 'mdi-controller-off'"
                size="small"
                variant="tonal"
                class="me-3"
              >
                {{ gaming ? bc("gaming") : bc("notGaming") }}
              </v-chip>
            </template>
          </v-tooltip>
        </template>
      </template>

      <!-- Until the page's content renders (a frame after it shows): its
           placeholders. -->
      <div v-if="!contentReady" class="bandwidth">
        <v-skeleton-loader type="heading, text" class="bw-skeleton" />
        <v-skeleton-loader type="image" height="120" class="bw-skeleton" />
        <v-skeleton-loader v-for="n in 4" :key="n" type="list-item-avatar-two-line" class="bw-skeleton" />
      </div>
      <div v-else class="bandwidth">
        <v-alert
          v-if="!running"
          type="info"
          variant="tonal"
          density="compact"
          :text="bc('serviceOff')"
        />

        <template v-else>
          <!-- The whole PC: download now, its last minute, today and month. -->
          <div class="bw-hero">
            <div class="bw-hero__text">
              <div class="text-caption text-medium-emphasis bw-num">
                {{ hoverTime || bc("allInternets") }}
              </div>
              <div class="bw-hero__speed bw-num">
                <v-icon
                  icon="mdi-arrow-down"
                  size="22"
                  class="bw-down" />
                {{ formatSpeed(atHover(total.series[0].points, total.speed)) }}
              </div>
              <div class="text-caption text-medium-emphasis bw-num">
                {{ bc("today") }} {{ formatSize(total.today) }} · {{ bc("thisMonth") }} {{ formatSize(total.month) }}
              </div>
            </div>
            <AppSparkline
              :series="total.series"
              :width="240"
              :height="48"
              :cursor-ago="hoverAgo"
              @hover="hoverAgo = $event" />
          </div>

          <!-- One card per internet. -->
          <div
            v-if="internetCards.length"
            class="bw-internets">
            <v-sheet
              v-for="card in internetCards"
              :key="card.name"
              rounded="lg"
              class="bw-card bw-internet">
              <div class="d-flex align-center ga-2">
                <v-icon
                  :icon="internetIcon(card.name)"
                  size="18"
                  class="text-medium-emphasis" />
                <span class="text-body-2 font-weight-medium text-truncate">{{ card.name }}</span>
                <v-spacer />
                <v-chip
                  v-if="card.isDefault"
                  size="x-small"
                  variant="tonal">
                  {{ bc("defaultInternet") }}
                </v-chip>
              </div>
              <div
                class="bw-internet__speed bw-num"
                :style="{ color: card.color }">
                ↓ {{ formatSpeed(atHover(card.points, card.speed)) }}
              </div>
              <AppSparkline
                :series="[{ points: card.points, color: card.color }]"
                :max="internetMax"
                :cursor-ago="hoverAgo"
                @hover="hoverAgo = $event"
                :width="240"
                :height="40"
                fill />
              <div class="text-caption text-medium-emphasis bw-num mt-1">
                {{ bc("today") }} {{ formatSize(card.today) }} · {{ bc("thisMonth") }} {{ formatSize(card.month) }}
              </div>
            </v-sheet>
          </div>

          <!-- The rules: caps, apps on another internet, Dedicated IPs. -->
          <v-sheet
            v-if="limits.length || routes.length || tunnels.length"
            rounded="lg"
            class="bw-card bw-list">
            <section v-if="limits.length">
              <div class="bw-section-title">
                {{ bc("caps") }}
              </div>
              <div
                v-for="limit in sortedLimits"
                :key="limit.id"
                class="bw-row">
                <v-avatar
                  size="32"
                  rounded="0"
                  class="flex-none">
                  <v-icon
                    v-if="limitIcon(limit)"
                    :icon="limitIcon(limit)"
                    class="text-medium-emphasis" />
                  <v-img
                    v-else-if="infoOf(limit.path).icon"
                    :src="infoOf(limit.path).icon" />
                  <v-icon
                    v-else
                    icon="mdi-application-outline"
                    class="text-medium-emphasis" />
                </v-avatar>
                <div class="bw-name">
                  <div class="text-body-2 font-weight-medium text-truncate">
                    {{ limitName(limit) }}
                  </div>
                  <div class="text-caption text-medium-emphasis text-truncate">
                    <template v-if="limit.kind !== 'exe' && limit.kind !== 'folder'">
                      {{ limitSubtitle(limit) }}
                    </template>
                    <span v-else dir="ltr">{{ limit.path }}</span>
                  </div>
                </div>
                <v-chip
                  :color="limitActive(limit) ? 'warning' : undefined"
                  size="small"
                  variant="tonal"
                  prepend-icon="mdi-speedometer-slow"
                >
                  {{ capLabel(limit, limitActive(limit)) }}
                </v-chip>
                <v-switch
                  :model-value="limit.enabled"
                  color="primary"
                  density="compact"
                  hide-details
                  class="flex-none"
                  @update:model-value="toggle(limit, $event)"
                />
                <v-btn
                  icon="mdi-pencil-outline"
                  size="small"
                  variant="text"
                  color="medium-emphasis"
                  :aria-label="bc('editCap')"
                  @click="openForLimit(limit)"
                />
              </div>
            </section>

            <section v-if="routes.length">
              <div class="bw-section-title">
                {{ bc("internets") }}
              </div>
              <div
                v-for="route in routes"
                :key="route.id"
                class="bw-row">
                <v-avatar
                  size="32"
                  rounded="0"
                  class="flex-none">
                  <v-icon
                    v-if="route.kind === 'folder'"
                    icon="mdi-folder-outline"
                    class="text-medium-emphasis" />
                  <v-img
                    v-else-if="infoOf(route.path).icon"
                    :src="infoOf(route.path).icon" />
                  <v-icon
                    v-else
                    icon="mdi-application-outline"
                    class="text-medium-emphasis" />
                </v-avatar>
                <div class="bw-name">
                  <div class="text-body-2 font-weight-medium text-truncate">
                    {{ routeName(route) }}
                  </div>
                  <div class="text-caption text-medium-emphasis text-truncate">
                    <span dir="ltr">{{ route.path }}</span>
                  </div>
                </div>
                <!-- The chip picks the internet right here. -->
                <v-menu location="bottom end">
                  <template #activator="{ props: menu }">
                    <v-chip
                      v-bind="menu"
                      size="small"
                      variant="tonal"
                      prepend-icon="mdi-swap-horizontal"
                      append-icon="mdi-menu-down"
                      :class="{ 'text-medium-emphasis': !route.enabled }"
                    >
                      {{ route.enabled ? bc("viaInternet", route.interface) : bc("internetOff") }}
                    </v-chip>
                  </template>
                  <v-list density="compact">
                    <v-list-item
                      v-for="name in internetNames"
                      :key="name"
                      :title="name"
                      :active="route.enabled && route.interface === name"
                      @click="useInternetFor(route, name)"
                    >
                      <template #append>
                        <v-icon
                          v-if="route.enabled && route.interface === name"
                          icon="mdi-check"
                          size="18" />
                      </template>
                    </v-list-item>
                  </v-list>
                </v-menu>
                <v-switch
                  :model-value="route.enabled"
                  color="primary"
                  density="compact"
                  hide-details
                  class="flex-none"
                  @update:model-value="toggleRoute(route, $event)"
                />
                <v-btn
                  icon="mdi-pencil-outline"
                  size="small"
                  variant="text"
                  color="medium-emphasis"
                  :aria-label="bc('editInternet')"
                  @click="openRoute(route)"
                />
              </div>
            </section>

            <section v-if="tunnels.length">
              <div class="bw-section-title">
                {{ bc("dedicatedIps") }}
              </div>
              <div
                v-for="tunnel in tunnels"
                :key="tunnel.id"
                class="bw-row">
                <v-avatar
                  size="32"
                  rounded="0"
                  class="flex-none">
                  <v-icon
                    v-if="tunnel.kind === 'pc'"
                    icon="mdi-monitor"
                    class="text-medium-emphasis" />
                  <v-icon
                    v-else-if="tunnel.kind === 'folder'"
                    icon="mdi-folder-outline"
                    class="text-medium-emphasis" />
                  <v-img
                    v-else-if="infoOf(tunnel.path).icon"
                    :src="infoOf(tunnel.path).icon" />
                  <v-icon
                    v-else
                    icon="mdi-application-outline"
                    class="text-medium-emphasis" />
                </v-avatar>
                <div class="bw-name">
                  <div class="text-body-2 font-weight-medium text-truncate">
                    {{ tunnelName(tunnel) }}
                  </div>
                  <div class="text-caption text-medium-emphasis text-truncate">
                    <span v-if="tunnel.kind === 'pc'">{{ bc("allApps") }}</span>
                    <span v-else dir="ltr">{{ tunnel.path }}</span>
                  </div>
                </div>
                <!-- The chip picks the config right here. -->
                <v-menu location="bottom end">
                  <template #activator="{ props: menu }">
                    <v-chip
                      v-bind="menu"
                      size="small"
                      variant="tonal"
                      append-icon="mdi-menu-down"
                      :class="{ 'text-medium-emphasis': !tunnel.enabled }"
                    >
                      <CountryFlag
                        v-if="configOf(tunnel.config_id)?.country"
                        :country="configOf(tunnel.config_id)!.country"
                        size="small"
                        class="me-1" />
                      {{ tunnel.enabled ? (configOf(tunnel.config_id)?.name ?? bc("dedicatedIpGone")) : bc("dedicatedIpOff") }}
                    </v-chip>
                  </template>
                  <v-list density="compact">
                    <v-list-item
                      v-for="config in wireGuardConfigs"
                      :key="config.id"
                      :active="tunnel.enabled && tunnel.config_id === config.id"
                      @click="useConfigFor(tunnel, config.id)"
                    >
                      <template #prepend>
                        <CountryFlag
                          v-if="config.country"
                          :country="config.country"
                          size="small"
                          class="me-2" />
                      </template>
                      <v-list-item-title>{{ config.name }}</v-list-item-title>
                      <v-list-item-subtitle>
                        <SensitiveText :text="config.ip" />
                      </v-list-item-subtitle>
                    </v-list-item>
                  </v-list>
                </v-menu>
                <v-switch
                  :model-value="tunnel.enabled"
                  color="primary"
                  density="compact"
                  hide-details
                  class="flex-none"
                  @update:model-value="saveTunnel({ ...tunnel, enabled: Boolean($event) })"
                />
                <v-btn
                  icon="mdi-pencil-outline"
                  size="small"
                  variant="text"
                  color="medium-emphasis"
                  :aria-label="bc('editDedicatedIp')"
                  @click="openTunnel(tunnel)"
                />
              </div>
            </section>
          </v-sheet>

          <!-- Every app: last minute, download now, data used. -->
          <v-sheet
            rounded="lg"
            class="bw-card bw-list">
            <div class="bw-apps-head d-flex align-center">
              <span class="text-subtitle-2">{{ bc("apps") }}</span>
              <div
                class="bw-search ms-1"
                :class="{ 'bw-search--open': searchOpen, 'bw-search--off': !apps.length }"
                v-tooltip:top="searchOpen ? undefined : bc('searchApps')"
                @click="openSearch">
                <v-text-field
                  ref="searchField"
                  v-model="search"
                  :placeholder="bc('searchApps')"
                  :aria-label="bc('searchApps')"
                  :tabindex="searchOpen ? 0 : -1"
                  prepend-inner-icon="mdi-magnify"
                  density="compact"
                  variant="solo-filled"
                  flat
                  rounded="pill"
                  hide-details
                  single-line
                  :clearable="searchOpen"
                  @click:clear="closeSearch"
                  @keydown.esc="closeSearch"
                  @blur="search?.trim() || closeSearch()" />
              </div>
              <v-spacer />
              <div class="bw-legend">
                <span
                  v-for="item in sparkLegend"
                  :key="item.name"
                  class="bw-legend__item">
                  <span
                    class="bw-dot"
                    :style="{ background: item.color }" />
                  {{ item.name }}
                </span>
              </div>
            </div>
            <div
              v-if="!apps.length"
              class="pa-4 text-medium-emphasis text-body-2">
              {{ bc("empty") }}
            </div>
            <div
              v-else-if="!shownApps.length"
              class="pa-4 text-medium-emphasis text-body-2">
              {{ bc("searchNone", search?.trim()) }}
            </div>
            <template v-else>
              <div class="bw-app bw-app--head text-caption text-medium-emphasis">
                <span />
                <span>{{ bc("colApp") }}</span>
                <span class="bw-col-chart">{{ bc("colLastMinute") }}</span>
                <span>{{ bc("colDownload") }}</span>
                <span class="text-end">{{ bc("colUsed") }}</span>
                <span />
              </div>
              <div
                v-for="app in shownApps"
                :key="app.path"
                class="bw-app bw-row"
                @contextmenu.prevent="openContext($event, app)">
                <v-avatar
                  size="32"
                  rounded="0">
                  <v-img
                    v-if="infoOf(app.path).icon"
                    :src="infoOf(app.path).icon" />
                  <v-icon
                    v-else
                    icon="mdi-application-outline"
                    class="text-medium-emphasis" />
                </v-avatar>
                <div class="bw-name">
                  <div class="text-body-2 font-weight-medium text-truncate">
                    {{ displayName(app.path, app.name) }}
                  </div>
                  <div class="bw-tags">
                    <template v-if="app.routed">
                      <v-chip
                        v-if="routedProfile(app)"
                        color="primary"
                        size="x-small"
                        variant="tonal"
                        v-tooltip:top="bc('openRoutedProfile', store.localized(routedProfile(app)!.name))"
                        @click="openRoutedProfile(app)"
                      >
                        {{ bc("routed") }}
                        <v-icon
                          icon="mdi-chevron-right"
                          size="14"
                          class="ms-1 bw-chevron" />
                      </v-chip>
                      <v-chip
                        v-else
                        color="primary"
                        size="x-small"
                        variant="tonal">
                        {{ bc("routed") }}
                      </v-chip>
                    </template>
                    <v-chip
                      v-if="app.rule_id && limitById.get(app.rule_id)"
                      :color="app.limited ? 'warning' : undefined"
                      size="x-small"
                      variant="tonal"
                      prepend-icon="mdi-speedometer-slow"
                      @click="openForApp(app)"
                    >
                      {{ capLabel(limitById.get(app.rule_id)!, app.limited) }}
                    </v-chip>
                    <v-chip
                      v-if="!app.routed && activeRoute(app.path)"
                      size="x-small"
                      variant="tonal"
                      prepend-icon="mdi-swap-horizontal"
                      @click="openRouteForApp(app)"
                    >
                      {{ bc("viaInternet", activeRoute(app.path)!.interface) }}
                    </v-chip>
                    <span class="text-caption text-medium-emphasis text-truncate">{{ usingText(app) }}</span>
                  </div>
                </div>
                <AppSparkline
                  class="bw-col-chart"
                  :series="sparks.get(app.path)?.series ?? []" />
                <div class="bw-download">
                  <div class="text-body-2 font-weight-medium bw-num">
                    {{ formatSpeed(app.download_speed) }}
                  </div>
                  <div class="bw-bar">
                    <span
                      :style="{
                        width: `${speedShare(app)}%`,
                        background: app.limited ? 'rgb(var(--v-theme-warning))' : lineColor,
                      }" />
                  </div>
                </div>
                <div class="text-end bw-num">
                  <div class="text-body-2">
                    {{ formatSize(app.today) }}
                  </div>
                  <div class="text-caption text-medium-emphasis">
                    {{ bc("usedMonth", formatSize(app.month)) }}
                  </div>
                </div>
                <div class="bw-actions">
                  <v-btn
                    :icon="app.rule_id ? 'mdi-speedometer-slow' : 'mdi-speedometer'"
                    size="small"
                    variant="text"
                    color="medium-emphasis"
                    :disabled="app.routed || app.path.startsWith(':')"
                    :aria-label="app.rule_id ? bc('editCap') : bc('addCap')"
                    v-tooltip="app.rule_id ? bc('editCap') : bc('addCap')"
                    @click="openForApp(app)"
                  />
                  <!-- LagZap picks the internet for apps it routes. -->
                  <v-btn
                    icon="mdi-swap-horizontal"
                    size="small"
                    variant="text"
                    color="medium-emphasis"
                    :disabled="app.routed || app.path.startsWith(':')"
                    :aria-label="bc('useInternet')"
                    v-tooltip="bc('useInternet')"
                    @click="openRouteForApp(app)"
                  />
                </div>
              </div>
            </template>
          </v-sheet>
        </template>
      </div>

      <v-menu
        v-model="contextOpen"
        :target="contextAt"
        location="bottom start">
        <v-list
          v-if="contextApp"
          density="compact">
          <v-list-item
            :prepend-icon="contextApp.rule_id ? 'mdi-speedometer-slow' : 'mdi-speedometer'"
            :title="contextApp.rule_id ? bc('editCap') : bc('addCap')"
            @click="openForApp(contextApp)"
          />
          <v-list-item
            prepend-icon="mdi-swap-horizontal"
            :title="bc('useInternet')"
            @click="openRouteForApp(contextApp)"
          />
          <v-list-item
            prepend-icon="mdi-tunnel-outline"
            :title="bc('useDedicatedIp')"
            @click="openTunnelForApp(contextApp)"
          />
        </v-list>
      </v-menu>

      <div
        v-if="running"
        class="bandwidth__fabs"
        :class="{ 'bandwidth__fabs--rtl': isRtl }">
        <v-menu
          location="top end"
          offset="8">
          <template #activator="{ props: menu }">
            <v-fab
              v-bind="menu"
              appear
              icon="mdi-sort"
              size="small"
              color="surface-variant"
              variant="elevated"
              v-tooltip="`${bc('sortBy')}: ${sortTitle}`"
              :aria-label="bc('sortBy')"
            />
          </template>
          <v-list density="compact">
            <v-list-subheader>
              {{ bc("sortBy") }}
            </v-list-subheader>
            <v-list-item
              v-for="option in sortOptions"
              :key="option.value"
              :title="option.title"
              :prepend-icon="option.icon"
              :active="sortKey === option.value"
              @click="sortKey = option.value"
            />
          </v-list>
        </v-menu>
        <v-menu
          location="top end"
          offset="8">
          <template #activator="{ props: menu }">
            <v-fab
              v-bind="menu"
              appear
              icon="mdi-plus"
              size="small"
              color="surface-variant"
              variant="elevated"
              v-tooltip="bc('addRule')"
              :aria-label="bc('addRule')"
            />
          </template>
          <v-list density="compact">
            <v-list-item
              :title="bc('addCustom')"
              prepend-icon="mdi-speedometer-slow"
              @click="openForCustom"
            />
            <v-list-item
              :title="bc('useInternet')"
              prepend-icon="mdi-swap-horizontal"
              @click="openRoute(null)"
            />
            <v-list-item
              :title="bc('useDedicatedIp')"
              prepend-icon="mdi-tunnel-outline"
              @click="openTunnel(null)"
            />
            <v-list-item
              :title="bc('dedicatedIpWholePc')"
              prepend-icon="mdi-monitor"
              @click="openTunnel(tunnels.find((item) => item.kind === 'pc') ?? null, true)"
            />
          </v-list>
        </v-menu>
        <v-fab
          appear
          prepend-icon="mdi-speedometer-slow"
          size="large"
          color="primary"
          variant="elevated"
          :text="pcLimit ? capLabel(pcLimit, limitActive(pcLimit)) : bc('pcCap')"
          @click="openForPC"
        />
      </div>
    </Container>

    <AppLimitDialog
      v-model="dialog"
      :path="dialogTarget.path"
      :name="dialogTarget.name"
      :limit="dialogTarget.limit"
      :speed="dialogTarget.speed"
      :fixed="dialogTarget.fixed"
      @save="saveLimit"
      @remove="deleteLimit"
    />
    <AppTunnelDialog
      v-model="tunnelDialog"
      :path="tunnelTarget.path"
      :name="tunnelTarget.name"
      :tunnel="tunnelTarget.tunnel"
      :whole-pc="tunnelTarget.wholePc"
      @save="saveTunnel"
      @remove="deleteTunnel"
    />
    <AppRouteDialog
      v-model="routeDialog"
      :path="routeTarget.path"
      :name="routeTarget.name"
      :route="routeTarget.route"
      @save="saveRoute"
      @remove="deleteRoute"
    />
  </div>
</template>

<style scoped>
.bw-skeleton {
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

/* Room under the last card for the buttons. */
.bandwidth {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 16px 190px;
}

.bandwidth__fabs {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 10000;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 12px;
}

.bandwidth__fabs--rtl {
  right: auto;
  left: 16px;
  align-items: flex-start;
}

/* Cards a step above the page, no border: LagZap's flat look. */
/* The game page's cards: its surface and a thin outline. */
.bw-card {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}

.v-theme--light .bw-card {
  background: rgb(var(--v-theme-background));
}

.bw-num {
  font-variant-numeric: tabular-nums;
}

.bw-down {
  color: v-bind(lineColor);
}

.bw-hero {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 4px 4px 0;
}

.bw-hero__text {
  flex: 1 1 auto;
  min-width: 0;
}

.bw-hero__speed {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 1.75rem;
  font-weight: 500;
  line-height: 1.2;
}

.bw-internets {
  display: grid;
  /* auto-fit: one or two internets stretch across the whole row. */
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.bw-internet {
  padding: 12px 14px;
  min-width: 0;
}

.bw-internet__speed {
  font-size: 1.125rem;
  font-weight: 500;
  margin: 6px 0 4px;
}

.bw-list {
  padding: 4px 0;
}

.bw-section-title,
.bw-apps-head {
  font-size: 0.875rem;
  font-weight: 500;
  padding: 10px 16px 4px;
}

.bw-apps-head {
  box-sizing: content-box;
  height: 32px;
}

.bw-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  min-height: 52px;
}

/* Inset dividers: from the text on, past the icon. */
.bw-row + .bw-row::before {
  content: "";
  position: absolute;
  top: 0;
  inset-inline: 60px 16px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.bw-name {
  flex: 1 1 auto;
  min-width: 0;
}

.flex-none {
  flex: none;
}

/* The apps table: icon, app, last minute, download, data used, actions. */
.bw-app {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 120px 140px 110px 72px;
  align-items: center;
  gap: 12px;
}

.bw-app--head {
  padding: 4px 16px 2px;
}

.bw-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin-top: 2px;
}

.bw-tags > .v-chip {
  flex: none;
}

.bw-chevron {
  opacity: 0.7;
}

.bw-download {
  min-width: 0;
}

.bw-bar {
  height: 4px;
  margin-top: 4px;
  border-radius: 2px;
  overflow: hidden;
  background: rgba(var(--v-theme-on-surface), 0.08);
}

.bw-bar > span {
  display: block;
  height: 100%;
  border-radius: 2px;
  transition: width 0.4s ease;
}

.bw-actions {
  display: flex;
  justify-content: flex-end;
}

/* Narrow windows drop the last-minute column first. */
@media (max-width: 1100px) {
  .bw-app {
    grid-template-columns: 32px minmax(0, 1fr) 120px 100px 72px;
  }

  .bw-col-chart {
    display: none;
  }
}

/* Closed, the search box is the magnifier alone: a 32px pill with no fill.
 * Opening fills the pill first, then widens it into the field; closing
 * runs back. */
.bw-search {
  flex: 0 1 auto;
  width: 32px;
  min-width: 32px;
  overflow: hidden;
  border-radius: 16px;
  cursor: pointer;
  transition: width 0.26s cubic-bezier(0.2, 0, 0, 1);
}

.bw-search--open {
  width: 220px;
  cursor: auto;
  transition-delay: 0.08s;
}

.bw-search--off {
  pointer-events: none;
  opacity: 0.38;
}

.bw-search :deep(.v-field) {
  transition: background-color 0.12s ease 0.18s;
}

.bw-search:not(.bw-search--open) :deep(.v-field) {
  background-color: transparent;
}

.bw-search:not(.bw-search--open):hover :deep(.v-field) {
  background-color: rgba(var(--v-theme-on-surface), 0.08);
  transition-delay: 0s;
}

.bw-search--open :deep(.v-field) {
  transition-delay: 0s;
}

.bw-search:not(.bw-search--open) :deep(.v-field__input) {
  opacity: 0;
  pointer-events: none;
}

.bw-search :deep(.v-field__input) {
  transition: opacity 0.15s ease 0.15s;
}

/* Compact: as tall as the title row's buttons. */
.bw-search :deep(.v-field) {
  --v-field-padding-start: 7px;
  --v-field-padding-end: 6px;
  font-size: 0.8125rem;
}

.bw-search :deep(.v-input__control),
.bw-search :deep(.v-field) {
  --v-input-control-height: 32px;
  height: 32px;
}

.bw-search :deep(.v-field__input) {
  min-height: 32px;
  padding-block: 0;
}

.bw-search :deep(.v-field__prepend-inner .v-icon),
.bw-search :deep(.v-field__clearable .v-icon) {
  font-size: 18px;
}

.bw-legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px 16px;
  margin-inline-start: 16px;
  font-size: 0.7rem;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.bw-legend__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.bw-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
</style>
