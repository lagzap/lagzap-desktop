<script setup lang="ts">
import { useLocale, useTheme } from "vuetify";
import Container from "~/components/layout/Container.vue";
import { interfaceBaseColor } from "~/composables/useLatencyMetrics";
import HelpTip from "~/components/settings/HelpTip.vue";
import AppSparkline, { type SparkSeries } from "~/components/network/bandwidth/AppSparkline.vue";
import AppLimitDialog from "~/components/network/bandwidth/AppLimitDialog.vue";
import AppRouteDialog from "~/components/network/bandwidth/AppRouteDialog.vue";
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
  internetsOf,
  infoOf,
  saveLimit,
  deleteLimit,
  saveRoute,
  deleteRoute,
} = useBandwidthControl();

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

type SortKey = "total" | "speed" | "name";
const sortKey = ref<SortKey>("total");
const sortOptions = computed(() => [
  { value: "total" as SortKey, title: bc("sortTotal"), icon: "mdi-sigma" },
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
      return list.sort((a, b) => b.download - a.download || byName(a, b));
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

      <div class="bandwidth">
        <v-alert
          v-if="!running"
          type="info"
          variant="tonal"
          density="compact"
          class="ma-4"
          :text="bc('serviceOff')"
        />

        <template v-else>
          <section v-if="limits.length">
            <div class="text-subtitle-2 px-4 pt-3 pb-1">
              {{ bc("caps") }}
            </div>
            <div
              v-for="limit in sortedLimits"
              :key="limit.id"
              class="bandwidth__row">
              <v-avatar
                size="32"
                rounded="0"
                class="flex-none">
                <v-icon
                  v-if="limitIcon(limit)"
                  :icon="limitIcon(limit)" />
                <v-img
                  v-else-if="infoOf(limit.path).icon"
                  :src="infoOf(limit.path).icon" />
                <v-icon
                  v-else
                  icon="mdi-application-outline" />
              </v-avatar>
              <div class="bandwidth__name">
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
                inset
                class="flex-none"
                @update:model-value="toggle(limit, $event)"
              />
              <v-btn
                icon="mdi-pencil-outline"
                size="small"
                variant="text"
                :aria-label="bc('editCap')"
                @click="openForLimit(limit)"
              />
            </div>
            <v-divider />
          </section>

          <section v-if="routes.length">
            <div class="text-subtitle-2 px-4 pt-3 pb-1">
              {{ bc("internets") }}
            </div>
            <div
              v-for="route in routes"
              :key="route.id"
              class="bandwidth__row">
              <v-avatar
                size="32"
                rounded="0"
                class="flex-none">
                <v-icon
                  v-if="route.kind === 'folder'"
                  icon="mdi-folder-outline" />
                <v-img
                  v-else-if="infoOf(route.path).icon"
                  :src="infoOf(route.path).icon" />
                <v-icon
                  v-else
                  icon="mdi-application-outline" />
              </v-avatar>
              <div class="bandwidth__name">
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
                    :color="route.enabled ? 'primary' : undefined"
                    size="small"
                    variant="tonal"
                    prepend-icon="mdi-swap-horizontal"
                    append-icon="mdi-menu-down"
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
                    color="primary"
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
                inset
                class="flex-none"
                @update:model-value="toggleRoute(route, $event)"
              />
              <v-btn
                icon="mdi-pencil-outline"
                size="small"
                variant="text"
                :aria-label="bc('editInternet')"
                @click="openRoute(route)"
              />
              <v-btn
                v-tooltip:top="bc('remove')"
                icon="mdi-delete-outline"
                size="small"
                variant="text"
                :aria-label="bc('remove')"
                @click="deleteRoute(route.id)"
              />
            </div>
            <v-divider />
          </section>

          <div class="bandwidth__apps-head d-flex align-center px-4 pt-3 pb-1">
            <span class="text-subtitle-2">{{ bc("apps") }}</span>
            <v-scale-transition :origin="isRtl ? 'center right' : 'center left'" mode="out-in">
              <v-btn
                v-if="!searchOpen"
                v-tooltip:top="bc('searchApps')"
                icon="mdi-magnify"
                size="small"
                variant="text"
                density="compact"
                class="ms-1"
                :aria-label="bc('searchApps')"
                :disabled="!apps.length"
                @click="searchOpen = true" />
              <v-text-field
                v-else
                v-model="search"
                :placeholder="bc('searchApps')"
                prepend-inner-icon="mdi-magnify"
                density="compact"
                variant="solo-filled"
                flat
                rounded="pill"
                hide-details
                single-line
                autofocus
                clearable
                class="bandwidth__search ms-2"
                @click:clear="closeSearch"
                @keydown.esc="closeSearch"
                @blur="search?.trim() || closeSearch()" />
            </v-scale-transition>
            <v-spacer />
            <div class="bandwidth__legend">
              <span
                v-for="item in sparkLegend"
                :key="item.name"
                class="bandwidth__internet">
                <span
                  class="bandwidth__dot"
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
          <div
            v-for="app in shownApps"
            :key="app.path"
            class="bandwidth__row"
            @contextmenu.prevent="openContext($event, app)">
            <v-avatar
              size="32"
              rounded="0"
              class="flex-none">
              <v-img
                v-if="infoOf(app.path).icon"
                :src="infoOf(app.path).icon" />
              <v-icon
                v-else
                icon="mdi-application-outline" />
            </v-avatar>
            <div class="bandwidth__name">
              <div class="d-flex align-center ga-2">
                <span class="text-body-2 font-weight-medium text-truncate">
                  {{ displayName(app.path, app.name) }}
                </span>
                <v-chip
                  v-if="app.routed"
                  color="primary"
                  size="x-small"
                  variant="tonal">
                  {{ bc("routed") }}
                </v-chip>
                <v-chip
                  v-if="app.rule_id && limitById.get(app.rule_id)"
                  :color="app.limited ? 'warning' : undefined"
                  size="x-small"
                  variant="tonal"
                  prepend-icon="mdi-speedometer-slow"
                >
                  {{ capLabel(limitById.get(app.rule_id)!, app.limited) }}
                </v-chip>
                <v-chip
                  v-if="!app.routed && activeRoute(app.path)"
                  color="primary"
                  size="x-small"
                  variant="tonal"
                  prepend-icon="mdi-swap-horizontal"
                >
                  {{ bc("viaInternet", activeRoute(app.path)!.interface) }}
                </v-chip>
              </div>
              <div class="text-caption text-medium-emphasis text-truncate">
                {{ bc("sessionTotal", formatSize(app.download)) }}
              </div>
            </div>
            <div class="bandwidth__speed text-body-2 font-weight-medium">
              {{ formatSpeed(app.download_speed) }}
            </div>
            <AppSparkline :series="sparks.get(app.path)?.series ?? []" />
            <v-btn
              :icon="app.rule_id ? 'mdi-speedometer-slow' : 'mdi-speedometer'"
              size="small"
              variant="text"
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
              :color="activeRoute(app.path) ? 'primary' : undefined"
              :disabled="app.routed || app.path.startsWith(':')"
              :aria-label="bc('useInternet')"
              v-tooltip="bc('useInternet')"
              @click="openRouteForApp(app)"
            />
          </div>
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
              color="primary"
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
/* Room under the last row for the buttons. */
.bandwidth {
  padding-bottom: 190px;
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

.bandwidth__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  min-height: 52px;
}

.bandwidth__row + .bandwidth__row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.bandwidth__name {
  flex: 1 1 auto;
  min-width: 0;
}

.bandwidth__speed {
  flex: none;
  min-width: 96px;
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.flex-none {
  flex: none;
}

.bandwidth__search {
  flex: 0 1 220px;
  min-width: 140px;
}

/* The Apps title row keeps one height whether the search icon or the box
 * shows. */
.bandwidth__apps-head {
  box-sizing: content-box;
  height: 32px;
}

/* Compact: as tall as the title row's buttons. */
.bandwidth__search :deep(.v-field) {
  --v-field-padding-start: 10px;
  --v-field-padding-end: 6px;
  font-size: 0.8125rem;
}

.bandwidth__search :deep(.v-input__control),
.bandwidth__search :deep(.v-field) {
  --v-input-control-height: 32px;
  height: 32px;
}

.bandwidth__search :deep(.v-field__input) {
  min-height: 32px;
  padding-block: 0;
}

.bandwidth__search :deep(.v-field__prepend-inner .v-icon),
.bandwidth__search :deep(.v-field__clearable .v-icon) {
  font-size: 18px;
}

.bandwidth__legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px 16px;
  margin-inline-start: 16px;
  font-size: 0.7rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.bandwidth__internet {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.bandwidth__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
}
</style>
