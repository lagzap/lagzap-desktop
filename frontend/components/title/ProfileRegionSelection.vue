<script setup lang="ts">
import { useLocale } from "vuetify";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import ContinentIcon from "~/components/icons/ContinentIcon.vue";
import Ping from "~/components/network/Ping.vue";
import CountryFlag from "vue-country-flag-next";
import { ProfileFlag } from "~/constants/profile";
import { useRegionSelection } from "~/composables/useRegionSelection";
import { useProfileEstimate } from "~/composables/useProfileChart";

const props = defineProps<{
  profile: Profile;
}>();

const locale = useLocale();
const { t } = locale;
const store = useStore();

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
  
  // Ping data
  bestPingMsForCurrentSelection,
  bestPingScoreForCurrentSelection,
} = useRegionSelection(props.profile);

// While the game is relayed the chip shows Go's Estimated Ping, the same
// number as the card subtitle; the probe-based value is only the fallback.
const estimate = useProfileEstimate(props.profile.id);
const chipPingMs = computed(() =>
  (estimate.value?.ping ?? 0) > 0 ? estimate.value!.ping : bestPingMsForCurrentSelection.value
);
const chipPingScore = computed(() =>
  (estimate.value?.ping ?? 0) > 0 ? estimate.value!.score : bestPingScoreForCurrentSelection.value
);

function getPingColor(score: number | null): string {
  if (score === null || score < 0) {
    return "tertiary";
  }

  if (score >= 80) {
    return "green";
  } else if (score >= 70) {
    return "lime";
  } else if (score >= 60) {
    return "amber";
  } else {
    return "red";
  }
}

function getPingIcon(score: number | null): string | null {
  if (score === null || score < 0) {
    return null;
  }
  if (score >= 80) {
    return "mdi-signal-cellular-3";
  } else if (score >= 60) {
    return "mdi-signal-cellular-2";
  } else {
    return "mdi-signal-cellular-1";
  }
}
</script>

<template>
  <v-menu
    v-model="dialogOpen"
    min-width="350"
    width="450"
    max-width="500"
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
          :color="getPingColor(chipPingScore)"
          :prepend-icon="getPingIcon(chipPingScore)"
          v-bind="props"
        >
          <template v-if="chipPingMs" #append>
            <small>
              {{ formatMs(chipPingMs) }}
            </small>
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
      width="400"
    >
      <v-card-text>
        <v-select
          v-if="!isNodeSelectionMode"
          v-model="mode"
          :items="[
            {
              value: 'global',
              text: t('$vuetify.title.profile.server.automatic'),
            },
            {
              value: 'region',
              text: t('$vuetify.title.profile.server.byRegion'),
            },
            {
              value: 'country',
              text: t('$vuetify.title.profile.server.byCountry'),
            },
            {
              value: 'city',
              text: t('$vuetify.title.profile.server.byCity'),
            },
            {
              value: 'direct',
              text: t('$vuetify.title.profile.server.directWithoutServer'),
            },
          ]"
          prepend-inner-icon="mdi-earth"
          color="accent"
          variant="outlined"
          item-title="text"
          item-value="value"
          :disabled="!store.appReady"
          hide-details
        />

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
            <div @click.stop="toggleRegion(region.tag)">
              <v-avatar size="32" class="me-3">
                <ContinentIcon :tag="region.tag" />
              </v-avatar>
              <span>{{ store.localized(region.name) }}</span>
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
              <v-avatar size="24" rounded="0">
                <span style="height: 40px">
                  <CountryFlag :country="countryCode" />
                </span>
              </v-avatar>
              <span class="text-caption ms-2">
                {{ countryName(countryCode) }}
              </span>
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
                <v-avatar size="24" rounded="0">
                  <span style="height: 40px">
                    <CountryFlag :country="cityMap[city]?.[0]?.country" />
                  </span>
                </v-avatar>
                <span class="text-caption ms-2">{{ getCityLabel(city) }}</span>
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
                <v-avatar size="24" rounded="0">
                  <span style="height: 40px">
                    <CountryFlag :country="cityMap[cityKey]?.[0]?.country" />
                  </span>
                </v-avatar>
                <span class="text-caption ms-2">{{ getCityLabel(cityKey) }}</span>
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
