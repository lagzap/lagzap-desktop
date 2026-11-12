<script setup lang="ts">
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

const props = defineProps<{
  profile: Profile;
}>();

const locale = useLocale();
const { t } = locale;
const store = useStore();
const plan = usePlanAccess();
/** Some servers are outside the plan: the list says better plans have more. */
const moreWithBetterPlan = computed(() =>
  Object.values(plan.access.value?.nodes ?? {}).some((a) => a === "locked"),
);

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
} = useRegionSelection(props.profile);

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
const automaticRoutes = computed(() =>
  Object.keys(cityHierarchy.value).reduce((sum, regionTag) => sum + cityRegionRoutes(regionTag), 0),
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
    location="left center"
    :close-on-content-click="false"
  >
    <template v-slot:activator="{ props }">
      <template
        v-if="
          profile.route_action == 'route' &&
          profile.flags & ProfileFlag.ALLOW_REGION_SELECTION
        "
      >
        <v-btn
          v-if="$vuetify.display.smAndUp"
          :text="currentSelectionText"
          class="text-none"
          variant="tonal"
          v-bind="props"
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
        <v-btn v-else icon="mdi-map-marker" variant="tonal"
        color="tertiary" v-bind="props" />
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
        <template v-for="regionTag in Object.keys(cityHierarchy)" :key="`auto-${regionTag}`">
          <template
            v-for="countryIso2 in Object.keys(cityHierarchy[regionTag])"
            :key="`auto-${regionTag}-${countryIso2}`"
          >
            <v-list-item
              v-for="city in getSortedCitiesForCountry(regionTag, countryIso2)"
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
                    <v-tooltip v-if="cityRoutes(city)" :text="routesTip(cityRoutes(city))" location="top" max-width="300" open-delay="200"><template #activator="{ props: tip }"><div v-bind="tip" class="route-count route-count-tip">{{ routesLabel(cityRoutes(city)) }}</div></template></v-tooltip>
                  </div>
                </div>
              </template>
              <template #append>
                <Ping
                  v-if="lowestPingForCity(city) !== null"
                  :tag="lowestPingForCity(city).tag"
                />
                <Ping v-else :tag="firstNodeIdForCity(city)" />
              </template>
            </v-list-item>
          </template>
        </template>
        <v-list-item v-if="Object.keys(cityHierarchy).length === 0">
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
          :disabled="region.active === false"
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

        <!-- Direct Option with Adapter Group -->
        <v-list-group :value="getNodeSelected('direct')">
          <template #activator="{ props }">
            <v-list-item @click="selectNode('direct')" v-bind="props">
              <template #prepend>
                <v-radio
                  hide-details
                  class="me-2"
                  density="compact"
                  color="primary"
                  :model-value="getNodeSelected('direct')"
                  @click="selectNode('direct')"
                />
              </template>
              <template #title>
                <v-avatar size="24" rounded="0">
                  <v-icon>mdi-call-split</v-icon>
                </v-avatar>
                <span class="text-caption ms-2">{{ t('$vuetify.title.profile.server.direct') }}</span>
              </template>
              <template #append>
                <v-btn
                  v-if="getNodeSelected('direct')"
                  icon
                  size="small"
                  variant="text"
                  :loading="loadingInterfaces"
                  :disabled="!store.appReady"
                  @click.stop="updateInterfaces"
                >
                  <v-icon size="16">mdi-refresh</v-icon>
                </v-btn>
                <span v-else class="text-caption text-medium-emphasis">
                  {{ t('$vuetify.title.profile.server.directWithoutServer') }}
                </span>
              </template>
            </v-list-item>
          </template>

          <!-- Available Adapters -->
          <v-list-item
            v-for="iface in interfaces"
            :key="iface.Name"
            density="compact"
            @click="store.profileStates[profile.id].default_interface = iface.Name"
          >
            <template #prepend>
              <v-radio
                hide-details
                class="me-2"
                density="compact"
                color="primary"
                :model-value="store.profileStates[profile.id].default_interface === iface.Name"
                @click.stop="store.profileStates[profile.id].default_interface = iface.Name"
              />
            </template>
            <template #title>
              <v-icon size="16" class="me-2">mdi-network</v-icon>
              <span class="text-caption">{{ iface.Name }}</span>
            </template>
          </v-list-item>
        </v-list-group>

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
