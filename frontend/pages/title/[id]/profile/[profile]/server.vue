<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import MiddleEast from "~/components/icons/regions/middle-east.vue";
import Europe from "~/components/icons/regions/europe.vue";
import country from "country-list-js";
import {
  RoutingMode,
  type Node,
  type RelayRoute,
} from "~/bindings/github.com/lagzap/lagzap/adapter";
import Ping from "~/components/Ping.vue";
import { useLocale } from "vuetify";

const { t } = useLocale();
const store = useStore();
const route = useRoute();

const profile = computed(() =>
  store.profiles.find((p) => p.id === (route.params.profile as string))
);

const regions = computed(() => Object.values(store.regions));
const areas = computed(() => {
  return Object.values(store.nodes)
    .slice()
    .sort((a, b) => {
      const countryA = country.findByIso2(a.country)?.name || "";
      const countryB = country.findByIso2(b.country)?.name || "";
      return countryA.localeCompare(countryB);
    })
    .reduce((acc, node) => {
      const area = node.country;
      acc[area] = acc[area] || [];
      acc[area].push(node);
      acc[area].sort((a, b) => a.name.localeCompare(b.name));

      return acc;
    }, {} as Record<string, Node[]>);
});

const echo = computed(() => store.routes || {});

function getLowestPingForCountry(nodes: Node[] | undefined): RelayRoute | null {
  if (!nodes || nodes.length === 0) return null;

  const pings = nodes
    .map((node) => echo.value[node.id])
    .filter((ping) => ping && ping.routes?.[0]?.min_latency > 0)
    .sort((a, b) => a.routes?.[0]?.min_latency - b.routes?.[0]?.min_latency);

  if (pings.length === 0) return null;
  return pings[0] as RelayRoute;
}

function getLowestPingForRegion(regionTag: string): RelayRoute | null {
  const countries = regionCountryMap.value[regionTag] || [];
  const nodes: Node[] = [];
  for (const c of countries) {
    const ns = areas.value[c] || [];
    for (const n of ns) nodes.push(n);
  }

  return getLowestPingForCountry(nodes);
}

const mode = computed<string>({
  get() {
    const m = store.profileStates[profile.value.id]?.mode;
    switch (m) {
      case RoutingMode.RoutingMode_ROUTING_MODE_REGIONAL:
        return "region";
      case RoutingMode.RoutingMode_ROUTING_MODE_COUNTRY:
        return "country";
      case RoutingMode.RoutingMode_ROUTING_MODE_CITY:
        return "city";
      default:
        return "global";
    }
  },
  set(v: string) {
    if (v === "region")
      store.profileStates[profile.value.id].mode =
        RoutingMode.RoutingMode_ROUTING_MODE_REGIONAL;
    else if (v === "country")
      store.profileStates[profile.value.id].mode =
        RoutingMode.RoutingMode_ROUTING_MODE_COUNTRY;
    else if (v === "city")
      store.profileStates[profile.value.id].mode =
        RoutingMode.RoutingMode_ROUTING_MODE_CITY;
    else
      store.profileStates[profile.value.id].mode =
        RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL;
    store.saveActionProfile(profile.value.id);
  },
});

const areaKeys = computed(() => Object.keys(areas.value || {}));

const cityMap = computed(() => {
  const map: Record<string, Node[]> = {};
  Object.values(areas.value || {}).forEach((nodes) => {
    nodes.forEach((n: Node) => {
      const city = n.name;
      map[city] = map[city] || [];
      map[city].push(n);
    });
  });
  Object.values(map).forEach((arr) =>
    arr.sort((a, b) => a.name.localeCompare(b.name))
  );
  return map;
});

const cityKeys = computed(() => Object.keys(cityMap.value || {}));

const allCitySelected = computed(() => {
  const pid = profile.value?.id;
  if (!pid) return false;
  const selected = store.profileStates[pid]?.cities || [];
  return cityKeys.value.length > 0 && selected.length === cityKeys.value.length;
});

const someCitySelected = computed(() => {
  const pid = profile.value?.id;
  if (!pid) return false;
  const selected = store.profileStates[pid]?.cities || [];
  return selected.length > 0 && selected.length < cityKeys.value.length;
});

function toggleSelectAllCities() {
  const pid = profile.value?.id;
  if (!pid) return;
  if (allCitySelected.value) store.profileStates[pid].cities = [];
  else store.profileStates[pid].cities = cityKeys.value.slice();
  store.saveActionProfile(pid);
}

// map city keys by country for grouped display
const cityByCountry = computed(() => {
  const map: Record<string, string[]> = {};
  Object.entries(cityMap.value || {}).forEach(([city, nodes]) => {
    nodes.forEach((n: Node) => {
      const c = n.country;
      map[c] = map[c] || [];
      if (!map[c].includes(city)) map[c].push(city);
    });
  });
  Object.values(map).forEach((arr) => arr.sort());
  return map;
});

// region -> country -> cities
const regionCityMap = computed(() => {
  const m: Record<string, Record<string, string[]>> = {};
  Object.keys(regionCountryMap.value || {}).forEach((regionTag) => {
    m[regionTag] = {};
    (regionCountryMap.value[regionTag] || []).forEach((countryCode) => {
      m[regionTag][countryCode] = cityByCountry.value[countryCode] || [];
    });
  });
  return m;
});

function getRegionCityMap(regionTag: string): Record<string, string[]> {
  return regionCityMap.value[regionTag] || {};
}

function citiesForCountry(countryCode: string): string[] {
  return cityByCountry.value[countryCode] || [];
}

function lowestPingForCity(city: string): RelayRoute | null {
  return getLowestPingForCountry(cityMap.value[city]);
}

function firstNodeIdForCity(city: string): string {
  return cityMap.value[city]?.[0]?.id || "";
}

function getCityLabel(cityKey: string): string {
  // cityKey corresponds to node.name (the kebab key). Find a node for this
  // city and return its localized city name when available.
  const node = cityMap.value[cityKey]?.[0];
  if (!node) return cityKey;

  // node.city may be a string or a localized object. Prefer localized output
  // via store.localized (used elsewhere in this file).
  const c = (node as any).city;
  if (typeof c === "string") return c;
  try {
    const label = store.localized(c);
    return label || cityKey;
  } catch (e) {
    return cityKey;
  }
}

function regionAllCitiesSelected(regionTag: string) {
  const pid = profile.value?.id;
  if (!pid) return false;
  const selected = store.profileStates[pid]?.cities || [];
  const countries = getRegionCityMap(regionTag);
  const cities = Object.values(countries).flat();
  return cities.length > 0 && cities.every((c) => selected.includes(c));
}

function regionSomeCitiesSelected(regionTag: string) {
  const pid = profile.value?.id;
  if (!pid) return false;
  const selected = store.profileStates[pid]?.cities || [];
  const countries = getRegionCityMap(regionTag);
  const cities = Object.values(countries).flat();
  const count = cities.filter((c) => selected.includes(c)).length;
  return count > 0 && count < cities.length;
}

function toggleCountryCities(countryCode: string) {
  const pid = profile.value?.id;
  if (!pid) return;
  const cities = cityByCountry.value[countryCode] || [];
  const selected = new Set(store.profileStates[pid].cities || ([] as string[]));

  // determine if all cities for this country are already selected
  const allSelected = cities.length > 0 && cities.every((c) => selected.has(c));
  if (allSelected) {
    cities.forEach((c) => selected.delete(c));
  } else {
    cities.forEach((c) => selected.add(c));
  }

  store.profileStates[pid].cities = Array.from(selected);
  store.saveActionProfile(pid);
}

function toggleRegionCities(regionTag: string) {
  const pid = profile.value?.id;
  if (!pid) return;
  const countries = getRegionCityMap(regionTag);
  const cities = Object.values(countries).flat();
  const selected = new Set(store.profileStates[pid].cities || ([] as string[]));
  if (regionAllCitiesSelected(regionTag)) {
    cities.forEach((c) => selected.delete(c));
  } else {
    cities.forEach((c) => selected.add(c));
  }
  store.profileStates[pid].cities = Array.from(selected);
  store.saveActionProfile(pid);
}

const allSelected = computed(() => {
  const pid = profile.value?.id;
  if (!pid) return false;
  const selected = store.profileStates[pid]?.countries || [];
  return areaKeys.value.length > 0 && selected.length === areaKeys.value.length;
});

const someSelected = computed(() => {
  const pid = profile.value?.id;
  if (!pid) return false;
  const selected = store.profileStates[pid]?.countries || [];
  return selected.length > 0 && selected.length < areaKeys.value.length;
});

function toggleSelectAll() {
  const pid = profile.value?.id;
  if (!pid) return;
  if (allSelected.value) {
    store.profileStates[pid].countries = [];
  } else {
    store.profileStates[pid].countries = areaKeys.value.slice();
  }
  store.saveActionProfile(pid);
}

const regionKeys = computed(() => (regions.value || []).map((r: any) => r.tag));

const allRegionsSelected = computed(() => {
  const pid = profile.value?.id;
  if (!pid) return false;
  const selected = store.profileStates[pid]?.regions || [];
  return (
    regionKeys.value.length > 0 && selected.length === regionKeys.value.length
  );
});

const someRegionsSelected = computed(() => {
  const pid = profile.value?.id;
  if (!pid) return false;
  const selected = store.profileStates[pid]?.regions || [];
  return selected.length > 0 && selected.length < regionKeys.value.length;
});

function toggleSelectAllRegions() {
  const pid = profile.value?.id;
  if (!pid) return;
  if (allRegionsSelected.value) {
    store.profileStates[pid].regions = [];
  } else {
    store.profileStates[pid].regions = regionKeys.value.slice();
  }
  store.saveActionProfile(pid);
}

const regionCountryMap = computed(() => {
  const map: Record<string, string[]> = {};
  (regions.value || []).forEach((r: any) => (map[r.tag] = []));

  for (const country of areaKeys.value) {
    const nodesForCountry = areas.value[country] || [];
    const nodeWithRegion = nodesForCountry.find(
      (n: any) => n.region !== undefined && n.region !== null
    );
    const regionTag = nodeWithRegion
      ? nodeWithRegion.region
      : nodesForCountry[0]?.region || "";
    if (!map[regionTag]) map[regionTag] = [];
    map[regionTag].push(country);
  }

  return map;
});

function regionAllSelected(regionTag: string) {
  const pid = profile.value?.id;
  if (!pid) return false;
  const selected = store.profileStates[pid]?.countries || [];
  const countries = regionCountryMap.value[regionTag] || [];
  return countries.length > 0 && countries.every((c) => selected.includes(c));
}

function regionSomeSelected(regionTag: string) {
  const pid = profile.value?.id;
  if (!pid) return false;
  const selected = store.profileStates[pid]?.countries || [];
  const countries = regionCountryMap.value[regionTag] || [];
  const count = countries.filter((c) => selected.includes(c)).length;
  return count > 0 && count < countries.length;
}

function toggleRegion(regionTag: string) {
  const pid = profile.value?.id;
  if (!pid) return;
  const countries = regionCountryMap.value[regionTag] || [];
  const selected = new Set(
    store.profileStates[pid].countries || ([] as string[])
  );

  if (regionAllSelected(regionTag)) {
    // remove all countries in the region
    countries.forEach((c) => selected.delete(c));
  } else {
    // add all countries in the region
    countries.forEach((c) => selected.add(c));
  }

  store.profileStates[pid].countries = Array.from(selected);
  store.saveActionProfile(pid);
}
</script>

<template>
  <div>
    <v-card-text>
      <v-chip-group
        v-model="mode"
        color="accent"
        class="mb-3"
        filter
        mandatory
        show-arrows
      >
        <v-chip rounded size="x-large" value="global">
          <span>{{ t("$vuetify.title.profile.server.automatic") }}</span>
        </v-chip>
        <v-chip rounded size="x-large" value="ai" disabled>
          <span>{{ t("$vuetify.title.profile.server.byAI") }}</span>
        </v-chip>
        <v-chip rounded size="x-large" value="region">
          <span>{{ t("$vuetify.title.profile.server.byRegion") }}</span>
        </v-chip>
        <v-chip rounded size="x-large" value="country">
          <span>{{ t("$vuetify.title.profile.server.byCountry") }}</span>
        </v-chip>
        <v-chip rounded size="x-large" value="city">
          <span>{{ t("$vuetify.title.profile.server.byCity") }}</span>
        </v-chip>
      </v-chip-group>

      <v-slide-x-transition leave-absolute>
        <v-empty-state v-if="mode == 'global'" icon="mdi-earth" class="my-15">
          <template v-slot:media>
            <v-icon color="surface-variant" />
          </template>

          <template v-slot:headline>
            <div class="text-h4 my-2">
              {{ t("$vuetify.title.profile.server.global") }}
            </div>
          </template>

          <template v-slot:title>
            <div class="text-h6">
              {{
                t(
                  "$vuetify.title.profile.server.automaticServerSelectionEnabled"
                )
              }}
            </div>
          </template>

          <template v-slot:text>
            <div class="text-medium-emphasis text-caption">
              {{ t("$vuetify.title.profile.server.routingSystemDescription") }}
            </div>
          </template>
        </v-empty-state>
        <v-item-group
          v-else-if="mode == 'region'"
          class="mb-3"
          multiple
          v-model="store.profileStates[profile.id].regions"
        >
          <v-toolbar density="compact" color="transparent" class="mb-3">
            <v-checkbox
              :model-value="allRegionsSelected"
              :indeterminate="someRegionsSelected"
              @click="toggleSelectAllRegions"
              :label="t('$vuetify.title.profile.server.selectAll')"
              hide-details
            />
            <v-spacer />
          </v-toolbar>
          <v-row dense>
            <v-col
              v-for="region in regions"
              :key="region.tag"
              cols="12"
              md="6"
              lg="4"
              xl="3"
            >
              <v-item
                :disabled="region.active === false"
                :value="region.tag"
                v-slot="{ isSelected, selectedClass, toggle }"
              >
                <v-card :title="store.localized(region.name)" @click="toggle">
                  <template #prepend>
                    <v-switch
                      inset
                      density="compact"
                      color="primary"
                      :model-value="isSelected"
                      class="me-3"
                      hide-details
                    />
                    <v-avatar size="48" class="me-3">
                      <Europe
                        v-if="region.tag == 'eu'"
                        src="~/assets/svgs/regions/europe.svg"
                      />
                      <MiddleEast
                        v-else-if="region.tag == 'me'"
                        src="~/assets/svgs/regions/middle-east.svg"
                      />
                    </v-avatar>
                  </template>

                  <template #append>
                    <div class="d-flex align-center">
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
                    </div>
                  </template>
                </v-card>
              </v-item>
            </v-col>
          </v-row>
        </v-item-group>
        <v-item-group
          v-else-if="mode == 'country'"
          class="mb-3"
          multiple
          v-model="store.profileStates[profile.id].countries"
        >
          <v-toolbar density="compact" color="transparent">
            <v-checkbox
              :model-value="allSelected"
              :indeterminate="someSelected"
              @click="toggleSelectAll"
              :label="t('$vuetify.title.profile.server.selectAll')"
              hide-details
            />
            <v-spacer />
          </v-toolbar>

          <v-snackbar
            :model-value="!store.profileStates[profile.id]?.countries?.length"
            color="warning"
            variant="elevated"
            text="No countries selected. Automatic selection will be used instead!"
            class="mb-3"
          />

          <v-card
            v-for="region in regions"
            :key="region.tag"
            :title="store.localized(region.name)"
            class="mb-6"
          >
            <template #append>
              <v-switch
                inset
                hide-details
                class="me-2"
                density="compact"
                color="primary"
                :model-value="regionAllSelected(region.tag)"
                :indeterminate="regionSomeSelected(region.tag)"
                @click="() => toggleRegion(region.tag)"
              />
            </template>
            <template #title>
              <v-card-title
                class="my-3 cursor-pointer"
                @click="() => toggleRegion(region.tag)"
              >
                <v-avatar size="24" class="me-3">
                  <Europe
                    v-if="region.tag == 'eu'"
                    src="~/assets/svgs/regions/europe.svg"
                  />
                  <MiddleEast
                    v-else-if="region.tag == 'me'"
                    src="~/assets/svgs/regions/middle-east.svg"
                  />
                </v-avatar>
                <span class="text-h6">{{ store.localized(region.name) }}</span>
              </v-card-title>
            </template>
            <v-card-text>
              <v-row dense>
                <v-col
                  v-for="countryCode in regionCountryMap[region.tag] || []"
                  :key="countryCode"
                  cols="12"
                  md="6"
                  lg="4"
                  xl="3"
                >
                  <v-item
                    :value="countryCode"
                    class="my-0"
                    v-slot="{ isSelected, selectedClass, toggle }"
                  >
                    <v-card density="compact" variant="outlined" @click="toggle">
                      <template #prepend>
                        <v-checkbox
                          :model-value="isSelected"
                          hide-details
                          class="my-0 me-4"
                          density="compact"
                        />
                        <span class="me-1" style="height: 40px">
                          <CountryFlag :country="countryCode" />
                        </span>
                      </template>

                      <template #title>
                        <span
                          class="text-subtitle-2 me-auto"
                          style="line-height: 2.5"
                        >
                          {{ country.findByIso2(countryCode)?.name }}
                        </span>
                      </template>

                      <template #append>
                        <Ping
                          v-if="
                            getLowestPingForCountry(areas[countryCode]) !== null
                          "
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
                    </v-card>
                  </v-item>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-item-group>
        <v-item-group
          v-else-if="mode == 'city'"
          class="mb-3"
          multiple
          v-model="store.profileStates[profile.id].cities"
        >
          <v-toolbar density="compact" color="transparent">
            <v-checkbox
              :model-value="allCitySelected"
              :indeterminate="someCitySelected"
              @click="toggleSelectAllCities"
              :label="t('$vuetify.title.profile.server.selectAll')"
              hide-details
            />
            <v-spacer />
          </v-toolbar>

          <v-snackbar
            :model-value="!store.profileStates[profile.id]?.cities?.length"
            color="warning"
            variant="elevated"
            text="No cities selected. Automatic selection will be used instead!"
            class="mb-3"
          />

          <v-card
            v-for="region in regions"
            :key="region.tag"
            class="mb-6"
          >
            <template #append>
              <v-switch
                inset
                hide-details
                class="me-2"
                density="compact"
                color="primary"
                :model-value="regionAllCitiesSelected(region.tag)"
                :indeterminate="regionSomeCitiesSelected(region.tag)"
                @click="() => toggleRegionCities(region.tag)"
              />
            </template>
            <template #title>
              <v-card-title
                class="my-3 cursor-pointer"
                @click="() => toggleRegionCities(region.tag)"
              >
                <v-avatar size="24" class="me-3">
                  <Europe
                    v-if="region.tag == 'eu'"
                    src="~/assets/svgs/regions/europe.svg"
                  />
                  <MiddleEast
                    v-else-if="region.tag == 'me'"
                    src="~/assets/svgs/regions/middle-east.svg"
                  />
                </v-avatar>
                <span class="text-h6">{{ store.localized(region.name) }}</span>
              </v-card-title>
            </template>

            <v-card-text>
              <v-row dense>
                <v-col
                  v-for="countryCode in Object.keys(
                    getRegionCityMap(region.tag) || {}
                  )"
                  :key="countryCode"
                  cols="12"
                >
                  <div
                    class="text-subtitle-2 mt-1 ms-3 d-flex align-center"
                    @click="() => toggleCountryCities(countryCode)"
                  >
                    <span class="me-1" style="height: 40px">
                      <CountryFlag :country="countryCode" />
                    </span>
                    <span class="ms-2">{{
                      country.findByIso2(countryCode)?.name
                    }}</span>
                  </div>

                  <v-row dense>
                    <v-col
                      v-for="city in getRegionCityMap(region.tag)[
                        countryCode
                      ] || []"
                      :key="city"
                      cols="12"
                      md="6"
                      lg="4"
                    >
                      <v-item :value="city" v-slot="{ isSelected, toggle }">
                        <v-card
                          density="compact"
                          variant="outlined"
                          @click="toggle"
                        >
                          <template #prepend>
                            <v-checkbox
                              :model-value="isSelected"
                              hide-details
                              density="compact"
                            />
                          </template>
                          <template #title>
                            <span class="text-subtitle-2">{{
                              getCityLabel(city)
                            }}</span>
                          </template>
                          <template #append>
                            <Ping
                              v-if="lowestPingForCity(city) !== null"
                              :tag="lowestPingForCity(city).tag"
                            />
                            <Ping v-else :tag="firstNodeIdForCity(city)" />
                          </template>
                        </v-card>
                      </v-item>
                    </v-col>
                  </v-row>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-item-group>
      </v-slide-x-transition>
    </v-card-text>
  </div>
</template>
