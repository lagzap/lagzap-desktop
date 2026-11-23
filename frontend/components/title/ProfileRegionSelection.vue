<script setup lang="ts">
import { mergeProps } from "vue";
import { useInternetsMenuRequest } from "~/composables/useInternetsMenu";
import { useLocale } from "vuetify";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import ContinentIcon from "~/components/icons/ContinentIcon.vue";
import Ping from "~/components/network/Ping.vue";
import CountryFlag from "vue-country-flag-next";
import { ProfileFlag } from "~/constants/profile";
import { useRegionSelection } from "~/composables/useRegionSelection";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { localDigits } from "~/utils/localeFormat";
import { DEFAULT_TCP_ROUTES, DEFAULT_UDP_ROUTES, resolveProfileRouteCounts } from "~/composables/routeCountUtils";
import { useNetworkAdapterSettings } from "~/composables/useNetworkAdapterSettings";
import SplitTunnelOptions from "~/components/title/SplitTunnelOptions.vue";
import LockedPlaces, { type LockedPlace } from "~/components/title/LockedPlaces.vue";
import ProfileWireGuard from "~/components/title/ProfileWireGuard.vue";
import LoadBalanceOptions from "~/components/title/LoadBalanceOptions.vue";
import { useProfileInternets } from "~/composables/useProfileInternets";

const props = defineProps<{
  profile: Profile;
  /** No button of its own: opened through v-model:open, shown at target
   * (Play from's "More options"). */
  bare?: boolean;
  target?: Element | null;
  /** Another copy of this profile's selector (Play from's More options):
   * a tip's Set up opens the card's own one, not this. */
  ignoreSetup?: boolean;
}>();
const openModel = defineModel<boolean>("open", { default: false });

const locale = useLocale();
const { t } = locale;
const store = useStore();
const plan = usePlanAccess();
/** Some servers are outside the plan: the list says better plans have more. */
const moreWithBetterPlan = computed(() =>
  Object.values(plan.access.value?.nodes ?? {}).some((a) => a === "locked"),
);

const regionSelection = useRegionSelection(props.profile);
const {
  // State
  dialogOpen,
  searchQuery,

  // Computed data
  sortedRegions,
  areas,
  regionCountryMap,
  cityMap,

  // Node selection mode
  isNodeSelectionMode,
  nodeMap,
  nodeHierarchy,
  getSortedNodesForCountry,
  getSortedRegionTags,
  getFilteredRegionTags,
  getFilteredNodesForCountry,

  // Interface-related
  interfaces,
  availableInterfaceNames,
  selectedDefaultInterface,
  orphanedInterfaces,
  loadingInterfaces,
  updateInterfaces,

  // City hierarchy (for city mode)
  cityHierarchy,
  getSortedCitiesForCountry,
  automaticCityHierarchy,
  getAutomaticCitiesForCountry,
  autoPickable,
  getRegionCitiesSelected,
  getRegionCitiesSomeSelected,
  toggleRegionCities,
  getRegionLocalizedName,

  // Filtered data
  filteredRegions,
  filteredRegionCountryMap,

  // Ping functions
  getLowestPingForCountry,
  getLowestPingForRegion,
  lowestPingForCity,
  unavailablePing,
  unavailablePingForCity,
  unavailablePingForRegion,
  getLowestPingForNode,

  // City helpers
  getCityLabel,
  firstNodeIdForCity,
  getNodeCityLabel,
  getCitySelected,
  selectCity,

  // Selection helpers
  getNodeSelected,

  // Toggle functions
  toggleRegion,
  toggleCountry,
  toggleCity,
  selectNode,

  // Select all state
  allRegionsSelected,
  someRegionsSelected,
  allCountriesSelected,
  someCountriesSelected,
  allCitiesSelected,
  someCitiesSelected,

  // Select all functions
  toggleAllRegions,
  toggleAllCountries,
  toggleAllCities,

  // Mode management
  mode,
  currentSelectionText,
  currentSelectionIcon,
  
  // Ping data
  bestPingMsForCurrentSelection,

  // Places the plan locks
  lockedNodes,
  lockedCityMap,
  lockedAreas,
} = regionSelection;

// Locked places end each list, with a purchase icon (LockedPlaces.vue).
const lockedSearch = (places: LockedPlace[]) => {
  const q = searchQuery.value.trim().toLowerCase();
  const out = q ? places.filter((p) => p.label.toLowerCase().includes(q) || countryName(p.country).toLowerCase().includes(q)) : places;
  return out.sort((a, b) => countryName(a.country).localeCompare(countryName(b.country)) || a.label.localeCompare(b.label));
};
const lockedCountryPlaces = computed(() =>
  lockedSearch(Object.keys(lockedAreas.value).map((code) => ({ key: code, label: countryName(code) || code, country: code }))),
);
const lockedCityPlaces = computed(() =>
  lockedSearch(
    Object.entries(lockedCityMap.value).map(([key, nodes]) => ({ key, label: getCityLabel(key), country: nodes[0]?.country ?? "" })),
  ),
);
const lockedServerPlaces = computed(() =>
  lockedSearch(lockedNodes.value.map((n) => ({ key: n.id, label: n.name, country: n.country }))),
);
watch(openModel, (v) => (dialogOpen.value = v));
watch(dialogOpen, (v) => (openModel.value = v));

const modes = computed(() => [
  { value: "global", icon: "mdi-auto-fix", text: t("$vuetify.title.profile.server.automatic") },
  { value: "region", icon: "mdi-earth", text: t("$vuetify.title.profile.server.byRegion") },
  { value: "country", icon: "mdi-flag-outline", text: t("$vuetify.title.profile.server.byCountry") },
  { value: "city", icon: "mdi-city-variant-outline", text: t("$vuetify.title.profile.server.byCity") },
  { value: "direct", icon: "mdi-call-split", text: t("$vuetify.title.profile.server.directWithoutServer") },
]);

// Route counts: how many route paths LagZap can use to reach these servers
// (each server's routes, summed), shown under each location and in total.
const routesOf = (nodes?: { id: string }[]) =>
  (nodes ?? []).reduce((sum, node) => sum + (store.routes[node.id]?.routes?.length ?? 0), 0);
const cityRoutes = (city: string) => routesOf(cityMap.value[city]);
const countryRoutes = (country: string) => routesOf(areas.value[country]);
const regionRoutes = (regionTag: string) =>
  (regionCountryMap.value[regionTag] ?? []).reduce((sum, country) => sum + countryRoutes(country), 0);
const cityRegionRoutes = (regionTag: string) =>
  Object.keys(cityHierarchy.value[regionTag] ?? {}).reduce(
    (sum, country) =>
      sum + getSortedCitiesForCountry(regionTag, country).reduce((n: number, city: string) => n + cityRoutes(city), 0),
    0,
  );
/** A city's routes over the servers Automatic can pick there. */
const automaticCityRoutes = (city: string) => routesOf(cityMap.value[city]?.filter(autoPickable));
const automaticRoutes = computed(() =>
  Object.entries(automaticCityHierarchy.value).reduce(
    (sum, [regionTag, countries]) =>
      sum +
      Object.keys(countries).reduce(
        (n, country) =>
          n + getAutomaticCitiesForCountry(regionTag, country).reduce((m: number, city: string) => m + automaticCityRoutes(city), 0),
        0,
      ),
    0,
  ),
);
const routesLabel = (n: number) => t("$vuetify.title.profile.server.routeCount", localDigits(n));

// How many of those routes LagZap keeps active for this profile: its route
// setting on each internet that joins Multi Internet.
const { resolvedGlobalTcp, resolvedGlobalUdp, multiInternet } = useNetworkAdapterSettings();
const internetCount = computed(() => Math.max(1, multiInternet.selection.value.length));
const activeRoutes = computed(() => {
  const counts = resolveProfileRouteCounts(store.profileStates[props.profile.id], {
    tcp: resolvedGlobalTcp.value ?? DEFAULT_TCP_ROUTES,
    udp: resolvedGlobalUdp.value ?? DEFAULT_UDP_ROUTES,
  });
  return counts.total * internetCount.value;
});
/** "LagZap keeps 4 routes active, picked from 86 possible route paths (over your 3 internets)." */
const routesTip = (possible: number) =>
  internetCount.value > 1
    ? t(
        "$vuetify.title.profile.server.routesActiveHintMulti",
        localDigits(Math.min(activeRoutes.value, possible)),
        localDigits(possible),
        localDigits(internetCount.value),
      )
    : t(
        "$vuetify.title.profile.server.routesActiveHint",
        localDigits(Math.min(activeRoutes.value, possible)),
        localDigits(possible),
      );

// Direct lists the adapters to send through: load them when it is picked.
watch(
  mode,
  (value) => {
    if (value === "direct" && !(interfaces.value?.length > 0)) void updateInterfaces();
  },
  { immediate: true },
);

// Its internets: Split Tunnel, Multi Internet, load balancing, Dedicated IP.
const {
  splitAdapter,
  splitAdapters,
  setSplitAdapter,
  toggleSplitTunnel,
  isMultiInternetProfile,
  multiOn,
  multiInherited,
  multiSelected,
  toggleMultiInternet,
  pickInternet,
  isLoadBalanceProfile,
  balanceMode,
  balanceAdapters,
  balanceSelected,
  balanceOn,
  setBalanceMode,
  pickBalanceInternet,
  pickSingleBalance,
  dedicatedIpOn,
  setLoadBalanceWeight,
  balanceShares,
  adapterIcon,
} = useProfileInternets(props.profile, regionSelection, dialogOpen);
// The button says which adapter Split Tunnel goes out through, or that
// Multi Internet is on.
const buttonText = computed(() => {
  if (isLoadBalanceProfile.value) {
    return balanceOn.value
      ? `${currentSelectionText.value} · ${t("$vuetify.title.profile.server.loadBalance")}`
      : splitAdapter.value
        ? `${currentSelectionText.value} · ${splitAdapter.value}`
        : currentSelectionText.value;
  }
  if (isMultiInternetProfile.value) {
    return multiOn.value || multiInherited.value
      ? `${currentSelectionText.value} · ${t("$vuetify.title.profile.multiInternet")}`
      : currentSelectionText.value;
  }
  return splitAdapter.value ? `${currentSelectionText.value} · ${splitAdapter.value}` : currentSelectionText.value;
});
watch(dialogOpen, (open) => {
  if (open && !(interfaces.value?.length > 0)) void updateInterfaces();
});

// A tip's Set up: open on the internets (Multi Internet or Load balancing)
// and make them stand out for a moment.
const internetsRequest = useInternetsMenuRequest(() => props.profile.id);
const highlightInternets = ref(false);
let highlightTimer: ReturnType<typeof setTimeout> | undefined;
watch(internetsRequest, (at) => {
  if (props.ignoreSetup) return;
  if (!at) return;
  dialogOpen.value = true;
  highlightInternets.value = true;
  clearTimeout(highlightTimer);
  highlightTimer = setTimeout(() => (highlightInternets.value = false), 2400);
  setTimeout(() => document.querySelector(".internets-highlight")?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 250);
});
onBeforeUnmount(() => clearTimeout(highlightTimer));

</script>

<template>
  <v-menu
    v-model="dialogOpen"
    min-width="350"
    width="520"
    max-width="560"
    :open-delay="0"
    :close-delay="0"
    scrollable
    :location="bare ? 'bottom start' : 'left center'"
    :close-on-content-click="false"
    :target="bare ? target ?? undefined : undefined"
  >
    <template v-if="!bare" v-slot:activator="{ props }">
      <template
        v-if="
          profile.route_action == 'route' &&
          profile.flags & ProfileFlag.ALLOW_REGION_SELECTION
        "
      >
        <!-- What the regions do, after a half-second hover. -->
        <v-tooltip
          v-if="$vuetify.display.smAndUp"
          :text="t('$vuetify.title.profile.server.regionTip')"
          location="top"
          max-width="300"
          open-delay="500"
          :disabled="dialogOpen"
        >
          <template #activator="{ props: tip }">
            <v-btn
              :text="buttonText"
              class="text-none"
              variant="tonal"
              v-bind="mergeProps(props, tip)"
            >
              <template #prepend>
                <CountryFlag v-if="'flag' in currentSelectionIcon" :country="currentSelectionIcon.flag" size="small" />
                <v-avatar v-else-if="'continent' in currentSelectionIcon" size="18" rounded="0">
                  <ContinentIcon :tag="currentSelectionIcon.continent" />
                </v-avatar>
                <v-icon v-else :icon="currentSelectionIcon.icon" />
              </template>
              <template #append>
                <v-icon :icon="dialogOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'" />
              </template>
            </v-btn>
          </template>
        </v-tooltip>
        <!-- Narrow: the same icon or flag as the wide button, with its text
             as the tooltip. -->
        <v-btn v-else icon variant="tonal" color="tertiary" v-tooltip="buttonText" v-bind="props">
          <CountryFlag v-if="'flag' in currentSelectionIcon" :country="currentSelectionIcon.flag" size="small" />
          <v-avatar v-else-if="'continent' in currentSelectionIcon" size="20" rounded="0">
            <ContinentIcon :tag="currentSelectionIcon.continent" />
          </v-avatar>
          <v-icon v-else :icon="currentSelectionIcon.icon" />
        </v-btn>
      </template>
    </template>

    <v-card
      v-if="
        (profile.flags & ProfileFlag.MULTIPATH) != 0
      "
      variant="outlined"
      width="500"
    >
      <v-alert
        v-if="moreWithBetterPlan"
        type="info"
        variant="tonal"
        density="compact"
        icon="mdi-rocket-launch-outline"
        class="ma-3 mb-0"
        :text="t('$vuetify.plan.moreAccess')"
      >
        <template v-if="plan.canUpgrade.value" #append>
          <v-btn size="small" variant="tonal" color="primary" @click="plan.openUpgrade">
            {{ t("$vuetify.plan.upgrade") }}
          </v-btn>
        </template>
      </v-alert>
      <v-card-text>
        <v-chip-group
          v-if="!isNodeSelectionMode"
          v-model="mode"
          mandatory
          show-arrows
          color="primary"
          :disabled="!store.appReady"
        >
          <v-chip
            v-for="item in modes"
            :key="item.value"
            :value="item.value"
            :prepend-icon="item.icon"
            variant="tonal"
            rounded="pill"
          >
            {{ item.text }}
          </v-chip>
        </v-chip-group>

        <!-- Search Input -->
        <v-text-field
          v-if="mode !== 'global' && mode !== 'direct' && !isNodeSelectionMode"
          v-model="searchQuery"
          prepend-inner-icon="mdi-magnify"
          :placeholder="
            isNodeSelectionMode ? t('$vuetify.title.profile.searchNodes') : t('$vuetify.title.profile.searchLocations')
          "
          variant="outlined"
          density="compact"
          hide-details
          clearable
          class="mt-3"
        />
      </v-card-text>

      <v-list v-if="mode !== 'direct'" density="compact" class="py-0" :disabled="!store.appReady">
        <SplitTunnelOptions
          v-if="isMultiInternetProfile"
          multi
          :highlight="highlightInternets"
          :on="multiOn"
          :inherited="multiInherited"
          :selected="multiSelected"
          :adapters="splitAdapters"
          :missing="orphanedInterfaces"
          :loading="loadingInterfaces"
          :disabled="!store.appReady"
          :live="dialogOpen"
          :icon="adapterIcon"
          @toggle="toggleMultiInternet"
          @pick="pickInternet"
          @refresh="updateInterfaces"
        />
        <LoadBalanceOptions
          v-else-if="isLoadBalanceProfile"
          :highlight="highlightInternets"
          :mode="dedicatedIpOn ? 'off' : balanceMode"
          :locked="dedicatedIpOn ? t('$vuetify.title.profile.server.loadBalanceDedicatedIp') : ''"
          :adapters="balanceAdapters"
          :selected="balanceSelected"
          :single-adapters="splitAdapters"
          :single="splitAdapter || store.defaultInterface || ''"
          :missing="orphanedInterfaces"
          :shares="balanceShares"
          :loading="loadingInterfaces"
          :disabled="!store.appReady"
          :live="dialogOpen"
          :icon="adapterIcon"
          @mode="setBalanceMode"
          @pick="pickBalanceInternet"
          @single="pickSingleBalance"
          @weight="(name: string, weight: number) => setLoadBalanceWeight(name, weight)"
          @refresh="updateInterfaces"
        />
        <SplitTunnelOptions
          v-else
          :on="!!splitAdapter"
          :selected="splitAdapter ? [splitAdapter] : []"
          :adapters="splitAdapters"
          :missing="orphanedInterfaces"
          :loading="loadingInterfaces"
          :disabled="!store.appReady"
          :live="dialogOpen"
          :icon="adapterIcon"
          @toggle="toggleSplitTunnel"
          @pick="setSplitAdapter"
          @refresh="updateInterfaces"
        />
        <ProfileWireGuard :profile-id="profile.id" :disabled="!store.appReady" />
      </v-list>
      <v-divider v-if="mode !== 'direct'" />

      <!-- Automatic: the servers it picks from, so people see what will be
           used. Only what this profile's groups and the plan allow. -->
      <v-list
        v-if="mode === 'global'"
        style="flex: 1"
        density="compact"
        class="automatic-servers"
      >
        <v-list-subheader>
          <div class="d-flex align-center ga-2">
            <span>{{ t("$vuetify.title.profile.server.automaticServers") }}</span>
            <v-spacer />
            <v-tooltip v-if="automaticRoutes" :text="routesTip(automaticRoutes)" location="top" max-width="300" open-delay="200">
              <template #activator="{ props: tip }">
                <v-chip v-bind="tip" size="x-small" variant="tonal" color="primary" prepend-icon="mdi-transit-connection-variant" class="route-count-tip">
                  {{ t("$vuetify.title.profile.server.totalRoutes", localDigits(automaticRoutes)) }}
                </v-chip>
              </template>
            </v-tooltip>
          </div>
        </v-list-subheader>
        <template v-for="regionTag in Object.keys(automaticCityHierarchy)" :key="`auto-${regionTag}`">
          <template
            v-for="countryIso2 in Object.keys(automaticCityHierarchy[regionTag])"
            :key="`auto-${regionTag}-${countryIso2}`"
          >
            <v-list-item
              v-for="city in getAutomaticCitiesForCountry(regionTag, countryIso2)"
              :key="`auto-${city}`"
              density="compact"
            >
              <template #title>
                <div class="d-flex align-center">
                  <v-avatar size="24" rounded="0">
                    <span style="height: 40px">
                      <CountryFlag :country="cityMap[city]?.[0]?.country" />
                    </span>
                  </v-avatar>
                  <div class="ms-2">
                    <div class="text-caption">{{ getCityLabel(city) }}</div>
                    <v-tooltip v-if="automaticCityRoutes(city)" :text="routesTip(automaticCityRoutes(city))" location="top" max-width="300" open-delay="200"><template #activator="{ props: tip }"><div v-bind="tip" class="route-count route-count-tip">{{ routesLabel(automaticCityRoutes(city)) }}</div></template></v-tooltip>
                  </div>
                </div>
              </template>
              <template #append>
                <Ping
                  v-if="lowestPingForCity(city) !== null"
                  :tag="lowestPingForCity(city).tag"
                />
                <v-tooltip v-else-if="unavailablePingForCity(city) !== null" :text="t('$vuetify.title.profile.server.unavailableTip')" location="top" max-width="260" open-delay="200">
                  <template #activator="{ props: tip }">
                    <span v-bind="tip" class="d-flex align-center ga-2">
                      <span class="text-caption text-medium-emphasis">{{ t("$vuetify.title.profile.server.unavailable") }}</span>
                      <Ping :latency-ms="unavailablePingForCity(city)" />
                    </span>
                  </template>
                </v-tooltip>
                <Ping v-else :tag="firstNodeIdForCity(city)" />
              </template>
            </v-list-item>
          </template>
        </template>
        <v-list-item v-if="Object.keys(automaticCityHierarchy).length === 0">
          <template #title>
            <span class="text-caption text-medium-emphasis">
              {{ t("$vuetify.title.profile.server.automaticNone") }}
            </span>
          </template>
        </v-list-item>
      </v-list>

      <!-- Region Selector -->
      <v-list
        v-if="mode === 'region'"
        style="flex: 1"
        width="100%"
        :disabled="!store.appReady"
      >
        <!-- Select All Option -->
        <v-list-item class="border-b">
          <template #title>
            <v-checkbox
              hide-details
              class="me-2"
              density="compact"
              color="primary"
              :model-value="allRegionsSelected"
              :indeterminate="someRegionsSelected"
              label="Select All Regions"
              @click.stop="toggleAllRegions"
            />
          </template>
        </v-list-item>

        <!-- Region Items -->
        <v-list-item
          v-for="region in filteredRegions"
          :key="region.tag"
          :disabled="region.active === false || (unavailablePingForRegion(region.tag) !== null && !(store.profileStates[profile.id].regions || []).includes(region.tag))"
          @click="toggleRegion(region.tag)"
        >
          <template #prepend>
            <v-checkbox
              hide-details
              class="me-2"
              density="compact"
              color="primary"
              :model-value="
                (store.profileStates[profile.id].regions || []).includes(
                  region.tag
                )
              "
              @click.stop="toggleRegion(region.tag)"
            />
          </template>
          <template #title>
            <div class="d-flex align-center" @click.stop="toggleRegion(region.tag)">
              <v-avatar size="32" class="me-3">
                <ContinentIcon :tag="region.tag" />
              </v-avatar>
              <div>
                <div>{{ store.localized(region.name) }}</div>
                <v-tooltip v-if="regionRoutes(region.tag)" :text="routesTip(regionRoutes(region.tag))" location="top" max-width="300" open-delay="200"><template #activator="{ props: tip }"><div v-bind="tip" class="route-count route-count-tip">{{ routesLabel(regionRoutes(region.tag)) }}</div></template></v-tooltip>
              </div>
            </div>
          </template>
          <template #append>
            <Ping
              v-if="getLowestPingForRegion(region.tag) !== null"
              :tag="getLowestPingForRegion(region.tag).tag"
            />
            <v-tooltip v-else-if="unavailablePingForRegion(region.tag) !== null" :text="t('$vuetify.title.profile.server.unavailableTip')" location="top" max-width="260" open-delay="200">
                  <template #activator="{ props: tip }">
                    <span v-bind="tip" class="d-flex align-center ga-2">
                      <span class="text-caption text-medium-emphasis">{{ t("$vuetify.title.profile.server.unavailable") }}</span>
                      <Ping :latency-ms="unavailablePingForRegion(region.tag)" />
                    </span>
                  </template>
                </v-tooltip>
                <Ping
              v-else
              :tag="
                (regionCountryMap[region.tag] &&
                  areas[regionCountryMap[region.tag][0]] &&
                  areas[regionCountryMap[region.tag][0]][0] &&
                  areas[regionCountryMap[region.tag][0]][0].id) ||
                ''
              "
            />
          </template>
        </v-list-item>

        <!-- No results message -->
        <v-list-item v-if="searchQuery && filteredRegions.length === 0">
          <template #title>
            <span class="text-grey">
              No regions found matching "{{ searchQuery }}"
            </span>
          </template>
        </v-list-item>
      </v-list>

      <!-- Country Selector -->
      <v-list
        v-if="mode === 'country'"
        style="flex: 1"
        width="100%"
        :disabled="!store.appReady"
      >
        <!-- Select All Option -->
        <v-list-item class="border-b">
          <template #title>
            <v-checkbox
              hide-details
              class="me-2"
              density="compact"
              color="primary"
              :model-value="allCountriesSelected"
              :indeterminate="someCountriesSelected"
              :label="t('$vuetify.title.profile.selectAllCountries')"
              @click.stop="toggleAllCountries"
            />
          </template>
        </v-list-item>

        <!-- Regions and Countries -->
        <!-- Only continents that have countries (left after search) -->
        <template
          v-for="region in sortedRegions.filter((r) => filteredRegionCountryMap[r.tag]?.length)"
          :key="region.tag"
        >
          <!-- Region Subheader -->
          <v-list-item class="mt-2" density="compact">
            <template #prepend>
              <v-avatar size="20" rounded="0">
                <ContinentIcon :tag="region.tag" />
              </v-avatar>
            </template>
            <template #title>
              <span class="text-subtitle-2 font-weight-bold">
                {{ store.localized(region.name) }}
              </span>
              <v-tooltip v-if="regionRoutes(region.tag)" :text="routesTip(regionRoutes(region.tag))" location="top" max-width="300" open-delay="200"><template #activator="{ props: tip }"><span v-bind="tip" class="route-count route-count-tip ms-2">{{ routesLabel(regionRoutes(region.tag)) }}</span></template></v-tooltip>
            </template>
          </v-list-item>

          <!-- Countries in this region -->
          <v-list-item
            v-for="countryCode in filteredRegionCountryMap[region.tag] || []"
            :key="countryCode"
            density="compact"
            class="ms-3"
            :disabled="unavailablePing(areas[countryCode]) !== null && !(store.profileStates[profile.id].countries || []).includes(countryCode)"
            @click="toggleCountry(countryCode)"
          >
            <template #prepend>
              <v-checkbox
                hide-details
                class="me-2"
                density="compact"
                color="primary"
                :model-value="
                  (store.profileStates[profile.id].countries || []).includes(
                    countryCode
                  )
                "
                @click.stop="toggleCountry(countryCode)"
              />
            </template>
            <template #title>
              <div class="d-flex align-center">
                <v-avatar size="24" rounded="0">
                  <span style="height: 40px">
                    <CountryFlag :country="countryCode" />
                  </span>
                </v-avatar>
                <div class="ms-2">
                  <div class="text-caption">{{ countryName(countryCode) }}</div>
                  <v-tooltip v-if="countryRoutes(countryCode)" :text="routesTip(countryRoutes(countryCode))" location="top" max-width="300" open-delay="200"><template #activator="{ props: tip }"><div v-bind="tip" class="route-count route-count-tip">{{ routesLabel(countryRoutes(countryCode)) }}</div></template></v-tooltip>
                </div>
              </div>
            </template>
            <template #append>
              <Ping
                v-if="getLowestPingForCountry(areas[countryCode]) !== null"
                :tag="getLowestPingForCountry(areas[countryCode]).tag"
              />
              <v-tooltip v-else-if="unavailablePing(areas[countryCode]) !== null" :text="t('$vuetify.title.profile.server.unavailableTip')" location="top" max-width="260" open-delay="200">
                  <template #activator="{ props: tip }">
                    <span v-bind="tip" class="d-flex align-center ga-2">
                      <span class="text-caption text-medium-emphasis">{{ t("$vuetify.title.profile.server.unavailable") }}</span>
                      <Ping :latency-ms="unavailablePing(areas[countryCode])" />
                    </span>
                  </template>
                </v-tooltip>
                <Ping
                v-else
                :tag="
                  areas[countryCode] &&
                  areas[countryCode][0] &&
                  areas[countryCode][0].id
                "
              />
            </template>
          </v-list-item>
        </template>

        <!-- No results message -->
        <v-list-item
          v-if="
            searchQuery && Object.keys(filteredRegionCountryMap).length === 0
          "
        >
          <template #title>
            <span class="text-grey">
              No countries found matching "{{ searchQuery }}"
            </span>
          </template>
        </v-list-item>
        <LockedPlaces :places="lockedCountryPlaces" @upgrade="dialogOpen = false" />
      </v-list>

      <!-- City Selector -->
      <v-list
        v-if="mode === 'city'"
        style="flex: 1"
        width="100%"
        :disabled="!store.appReady"
      >
        <!-- Select All Option -->
        <v-list-item class="border-b">
          <template #title>
            <v-checkbox
              hide-details
              class="me-2"
              density="compact"
              color="primary"
              :model-value="allCitiesSelected"
              :indeterminate="someCitiesSelected"
              label="Select All Cities"
              @click.stop="toggleAllCities"
            />
          </template>
        </v-list-item>

        <!-- Hierarchical City Items: Region > Country > Cities -->
        <template
          v-for="regionTag in Object.keys(cityHierarchy)"
          :key="regionTag"
        >
          <!-- Region Header -->
          <v-list-item class="mt-2" @click.stop="toggleRegionCities(regionTag)">
            <template #prepend>
              <v-checkbox
                hide-details
                class="me-2"
                density="compact"
                color="primary"
                :model-value="getRegionCitiesSelected(regionTag)"
                :indeterminate="getRegionCitiesSomeSelected(regionTag)"
                @click.stop="toggleRegionCities(regionTag)"
              />
            </template>
            <template #title>
              <v-avatar size="24" rounded="0">
                <ContinentIcon :tag="regionTag" />
              </v-avatar>
              <span class="text-body-2 ms-2 text-grey">
                {{ getRegionLocalizedName(regionTag) }}
              </span>
              <v-tooltip v-if="cityRegionRoutes(regionTag)" :text="routesTip(cityRegionRoutes(regionTag))" location="top" max-width="300" open-delay="200"><template #activator="{ props: tip }"><span v-bind="tip" class="route-count route-count-tip ms-2">{{ routesLabel(cityRegionRoutes(regionTag)) }}</span></template></v-tooltip>
            </template>
          </v-list-item>

          <!-- Cities in Region (sorted by country) -->
          <template
            v-for="countryIso2 in Object.keys(cityHierarchy[regionTag])"
            :key="`${regionTag}-${countryIso2}`"
          >
            <!-- Cities in Country -->
            <v-list-item
              v-for="city in getSortedCitiesForCountry(regionTag, countryIso2)"
              :key="city"
              density="compact"
              class="ml-4"
              :disabled="unavailablePingForCity(city) !== null && !getCitySelected(city)"
              @click="toggleCity(city)"
            >
              <template #prepend>
                <v-checkbox
                  hide-details
                  class="me-2"
                  density="compact"
                  color="primary"
                  :model-value="getCitySelected(city)"
                  @click.stop="toggleCity(city)"
                />
              </template>
              <template #title>
                <div class="d-flex align-center">
                  <v-avatar size="24" rounded="0">
                    <span style="height: 40px">
                      <CountryFlag :country="cityMap[city]?.[0]?.country" />
                    </span>
                  </v-avatar>
                  <div class="ms-2">
                    <div class="text-caption">{{ getCityLabel(city) }}</div>
                    <v-tooltip v-if="cityRoutes(city)" :text="routesTip(cityRoutes(city))" location="top" max-width="300" open-delay="200"><template #activator="{ props: tip }"><div v-bind="tip" class="route-count route-count-tip">{{ routesLabel(cityRoutes(city)) }}</div></template></v-tooltip>
                  </div>
                </div>
              </template>
              <template #append>
                <Ping
                  v-if="lowestPingForCity(city) !== null"
                  :tag="lowestPingForCity(city).tag"
                />
                <v-tooltip v-else-if="unavailablePingForCity(city) !== null" :text="t('$vuetify.title.profile.server.unavailableTip')" location="top" max-width="260" open-delay="200">
                  <template #activator="{ props: tip }">
                    <span v-bind="tip" class="d-flex align-center ga-2">
                      <span class="text-caption text-medium-emphasis">{{ t("$vuetify.title.profile.server.unavailable") }}</span>
                      <Ping :latency-ms="unavailablePingForCity(city)" />
                    </span>
                  </template>
                </v-tooltip>
                <Ping v-else :tag="firstNodeIdForCity(city)" />
              </template>
            </v-list-item>
          </template>
        </template>

        <!-- No results message -->
        <v-list-item
          v-if="searchQuery && Object.keys(cityHierarchy).length === 0"
        >
          <template #title>
            <span class="text-grey">
              No cities found matching "{{ searchQuery }}"
            </span>
          </template>
        </v-list-item>
        <LockedPlaces :places="lockedCityPlaces" @upgrade="dialogOpen = false" />
      </v-list>

      <!-- Direct: split tunneling — the adapter this profile's games go
           straight out through, no LagZap server. -->
      <v-list
        v-if="mode === 'direct'"
        style="flex: 1"
        width="100%"
        density="compact"
        :disabled="!store.appReady"
      >
        <v-list-subheader class="d-flex align-center">
          {{ t("$vuetify.title.profile.server.directThrough") }}
          <v-btn
            icon
            size="x-small"
            variant="text"
            class="ms-1"
            :loading="loadingInterfaces"
            @click.stop="updateInterfaces"
          >
            <v-icon size="16">mdi-refresh</v-icon>
          </v-btn>
        </v-list-subheader>
        <v-list-item @click="store.profileStates[profile.id].default_interface = ''">
          <template #prepend>
            <v-radio
              hide-details
              class="me-2"
              density="compact"
              color="primary"
              :model-value="!store.profileStates[profile.id].default_interface"
            />
          </template>
          <template #title>
            <v-icon size="16" class="me-2">mdi-auto-fix</v-icon>
            <span class="text-body-2">{{ t("$vuetify.title.profile.server.directSystemDefault") }}</span>
          </template>
        </v-list-item>
        <v-list-item
          v-for="iface in interfaces"
          :key="iface.Name"
          @click="store.profileStates[profile.id].default_interface = iface.Name"
        >
          <template #prepend>
            <v-radio
              hide-details
              class="me-2"
              density="compact"
              color="primary"
              :model-value="store.profileStates[profile.id].default_interface === iface.Name"
            />
          </template>
          <template #title>
            <v-icon size="16" class="me-2">mdi-network</v-icon>
            <span class="text-body-2">{{ iface.Name }}</span>
          </template>
        </v-list-item>
      </v-list>
    </v-card>
    <v-card
      v-else-if="(profile.flags & ProfileFlag.ALLOW_REGION_SELECTION) != 0"
    >
      <v-card-text>
        <!-- Search Input -->
        <v-text-field
          v-model="searchQuery"
          prepend-inner-icon="mdi-magnify"
          :placeholder="t('$vuetify.title.profile.server.searchNodes')"
          variant="outlined"
          density="compact"
          hide-details
          clearable
        />
      </v-card-text>

      <v-list width="100%" :disabled="!store.appReady">
        <!-- Automatic Option -->
        <v-list-item @click="selectNode('')">
          <template #prepend>
            <v-radio
              hide-details
              class="me-2"
              density="compact"
              color="primary"
              :model-value="getNodeSelected('')"
              @click.stop="selectNode('')"
            />
          </template>
          <template #title>
            <v-avatar size="24" rounded="0">
              <v-icon color="primary">mdi-auto-fix</v-icon>
            </v-avatar>
            <span class="text-caption ms-2">{{ t('$vuetify.title.profile.server.automatic') }}</span>
          </template>
          <template #append>
            <span class="text-caption text-medium-emphasis">
              {{ t('$vuetify.title.profile.server.automaticServerSelection') }}
            </span>
          </template>
        </v-list-item>

        <!-- Direct: no LagZap server at all. -->
        <v-list-item @click="selectNode('direct')">
          <template #prepend>
            <v-radio
              hide-details
              class="me-2"
              density="compact"
              color="primary"
              :model-value="getNodeSelected('direct')"
              @click.stop="selectNode('direct')"
            />
          </template>
          <template #title>
            <v-avatar size="24" rounded="0">
              <v-icon>mdi-arrow-right-thin</v-icon>
            </v-avatar>
            <span class="text-caption ms-2">{{ t('$vuetify.title.profile.server.directWithoutServer') }}</span>
          </template>
        </v-list-item>

        <!-- Split Tunnel: works with any server choice above or below. -->
        <v-divider class="my-1" />
        <SplitTunnelOptions
          v-if="isMultiInternetProfile"
          multi
          :highlight="highlightInternets"
          :on="multiOn"
          :inherited="multiInherited"
          :selected="multiSelected"
          :adapters="splitAdapters"
          :missing="orphanedInterfaces"
          :loading="loadingInterfaces"
          :disabled="!store.appReady"
          :live="dialogOpen"
          :icon="adapterIcon"
          @toggle="toggleMultiInternet"
          @pick="pickInternet"
          @refresh="updateInterfaces"
        />
        <LoadBalanceOptions
          v-else-if="isLoadBalanceProfile"
          :highlight="highlightInternets"
          :mode="dedicatedIpOn ? 'off' : balanceMode"
          :locked="dedicatedIpOn ? t('$vuetify.title.profile.server.loadBalanceDedicatedIp') : ''"
          :adapters="balanceAdapters"
          :selected="balanceSelected"
          :single-adapters="splitAdapters"
          :single="splitAdapter || store.defaultInterface || ''"
          :missing="orphanedInterfaces"
          :shares="balanceShares"
          :loading="loadingInterfaces"
          :disabled="!store.appReady"
          :live="dialogOpen"
          :icon="adapterIcon"
          @mode="setBalanceMode"
          @pick="pickBalanceInternet"
          @single="pickSingleBalance"
          @weight="(name: string, weight: number) => setLoadBalanceWeight(name, weight)"
          @refresh="updateInterfaces"
        />
        <SplitTunnelOptions
          v-else
          :on="!!splitAdapter"
          :selected="splitAdapter ? [splitAdapter] : []"
          :adapters="splitAdapters"
          :missing="orphanedInterfaces"
          :loading="loadingInterfaces"
          :disabled="!store.appReady"
          :live="dialogOpen"
          :icon="adapterIcon"
          @toggle="toggleSplitTunnel"
          @pick="setSplitAdapter"
          @refresh="updateInterfaces"
        />
        <ProfileWireGuard :profile-id="profile.id" :disabled="!store.appReady" />
        <v-divider class="my-1" />

        <!-- Hierarchical Node Items: Region > Country > Cities -->
        <template v-for="regionTag in getFilteredRegionTags()" :key="regionTag">
          <!-- Region Subheader -->
          <v-list-item class="mt-2" density="compact">
            <template #prepend>
              <v-avatar size="20" rounded="0">
                <ContinentIcon :tag="regionTag" />
              </v-avatar>
            </template>
            <template #title>
              <span class="text-subtitle-2 font-weight-bold">
                {{ getRegionLocalizedName(regionTag) }}
              </span>
            </template>
          </v-list-item>

          <!-- Countries in Region -->
          <template
            v-for="countryIso2 in Object.keys(nodeHierarchy[regionTag])"
            :key="`${regionTag}-${countryIso2}`"
          >
            <!-- Cities in Country -->
            <v-list-item
              v-for="cityKey in getFilteredNodesForCountry(
                regionTag,
                countryIso2
              )"
              :key="cityKey"
              density="compact"
              class="ml-4"
              @click="selectCity(cityKey)"
            >
              <template #prepend>
                <v-radio
                  hide-details
                  class="me-2"
                  density="compact"
                  color="primary"
                  :model-value="getCitySelected(cityKey)"
                  @click.stop="selectCity(cityKey)"
                />
              </template>
              <template #title>
                <div class="d-flex align-center">
                  <v-avatar size="24" rounded="0">
                    <span style="height: 40px">
                      <CountryFlag :country="cityMap[cityKey]?.[0]?.country" />
                    </span>
                  </v-avatar>
                  <div class="ms-2">
                    <div class="text-caption">{{ getCityLabel(cityKey) }}</div>
                    <v-tooltip v-if="cityRoutes(cityKey)" :text="routesTip(cityRoutes(cityKey))" location="top" max-width="300" open-delay="200"><template #activator="{ props: tip }"><div v-bind="tip" class="route-count route-count-tip">{{ routesLabel(cityRoutes(cityKey)) }}</div></template></v-tooltip>
                  </div>
                </div>
              </template>
              <template #append>
                <Ping
                  v-if="lowestPingForCity(cityKey) !== null"
                  :tag="lowestPingForCity(cityKey)!.tag"
                />
                <v-tooltip v-else-if="unavailablePingForCity(cityKey) !== null" :text="t('$vuetify.title.profile.server.unavailableTip')" location="top" max-width="260" open-delay="200">
                  <template #activator="{ props: tip }">
                    <span v-bind="tip" class="d-flex align-center ga-2">
                      <span class="text-caption text-medium-emphasis">{{ t("$vuetify.title.profile.server.unavailable") }}</span>
                      <Ping :latency-ms="unavailablePingForCity(cityKey)" />
                    </span>
                  </template>
                </v-tooltip>
                <Ping v-else :tag="firstNodeIdForCity(cityKey)" />
              </template>
            </v-list-item>
          </template>
        </template>

        <!-- No results message -->
        <v-list-item v-if="searchQuery && getSortedRegionTags().length === 0">
          <template #title>
            <span class="text-grey">
              {{ t('$vuetify.title.profile.server.noNodesSelected') }}
            </span>
          </template>
        </v-list-item>
        <LockedPlaces :places="lockedServerPlaces" @upgrade="dialogOpen = false" />
      </v-list>
    </v-card>
  </v-menu>
</template>

<style scoped>
/* Route count under a location's name. */
.route-count {
  font-size: 0.6875rem;
  line-height: 1.2;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

/* A route count explains itself on hover: dotted underline and a tooltip. */
.route-count-tip {
  cursor: help;
  text-decoration: underline dotted transparent;
  text-underline-offset: 3px;
  transition: text-decoration-color 0.15s;
}

.route-count-tip:hover {
  text-decoration-color: currentColor;
}
</style>
