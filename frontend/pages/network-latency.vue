<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import MiddleEast from "~/components/icons/regions/middle-east.vue";
import Europe from "~/components/icons/regions/europe.vue";
import country from "country-list-js";
import Ping from "~/components/Ping.vue";
import type { Node } from "~/bindings/github.com/lagzap/lagzap/adapter";

const store = useStore();
const regions = computed(() => store.regions);
const filterMode = ref('all');

const echo = computed(() => store.echo || {});

const areas = computed(() => {
  const allNodes = Object.values(store.nodes)
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

  if (filterMode.value !== 'all') {
    const filteredAreas: Record<string, Node[]> = {};
    Object.entries(allNodes).forEach(([area, nodes]) => {
      if (nodes[0]?.region === filterMode.value) {
        filteredAreas[area] = nodes;
      }
    });
    return filteredAreas;
  }

  return allNodes;
});

const areasByRegion = computed(() => {
  if (filterMode.value !== 'all') {
    return { [filterMode.value]: areas.value };
  }

  const regionGroups: Record<string, Record<string, Node[]>> = {};
  Object.entries(areas.value).forEach(([area, nodes]) => {
    const regionTag = nodes[0]?.region;
    if (regionTag) {
      regionGroups[regionTag] = regionGroups[regionTag] || {};
      regionGroups[regionTag][area] = nodes;
    }
  });

  const sortedRegionGroups: Record<string, Record<string, Node[]>> = {};
  Object.values(regions.value).forEach((region: any) => {
    if (regionGroups[region.tag]) {
      sortedRegionGroups[region.tag] = regionGroups[region.tag];
    }
  });

  return sortedRegionGroups;
});

const allCountries = computed(() => {
  const countries: string[] = [];
  if (filterMode.value === 'all') {
    Object.values(areasByRegion.value).forEach(regionAreas => {
      Object.keys(regionAreas).forEach(area => {
        countries.push(area);
      });
    });
  } else {
    Object.keys(areas.value).forEach(area => {
      countries.push(area);
    });
  }
  return countries;
});

const openedCountries = ref<string[]>(allCountries.value);

watch([allCountries, filterMode], () => {
  openedCountries.value = [...allCountries.value];
}, { immediate: true });

onMounted(async () => {
  await store.updateEcho();
})

async function pingTag(tag: string) {
  const latency = await store.pingNode(tag)
  console.log(latency)
}
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title>Network Latency</v-app-bar-title>

        <v-spacer />
        <v-btn variant="plain" :loading="store.optimizing" @click="store.optimize()">
          Optimize
        </v-btn>
      </template>
      <v-card-text>
        <v-chip-group v-model="filterMode" color="primary" class="mb-3" filter mandatory>
          <v-chip rounded size="large" value="all">
            <span>All Regions</span>
          </v-chip>
          <v-chip 
            v-for="region in regions"
            :key="region.tag"
            rounded 
            size="large" 
            :value="region.tag"
            :disabled="region.active === false"
          >
            <template #prepend>
              <v-avatar size="24" class="me-2">
                <Europe
                  v-if="region.tag == 'europe'"
                  src="~/assets/svgs/regions/europe.svg"
                />
                <MiddleEast
                  v-else-if="region.tag == 'middle-east'"
                  src="~/assets/svgs/regions/middle-east.svg"
                />
              </v-avatar>
            </template>
            <span>{{ region.name }}</span>
          </v-chip>
        </v-chip-group>

        <v-list class="bg-transparent" density="compact" :opened="openedCountries">
          <template v-if="filterMode === 'all'">
            <template v-for="[regionTag, regionAreas] in Object.entries(areasByRegion)" :key="regionTag">
              <v-list-subheader>
                {{ Object.values(regions).find((r: any) => r.tag === regionTag)?.name }}
              </v-list-subheader>
              
              <v-list-group
                v-for="[area, nodes] in Object.entries(regionAreas)"
                :key="area"
                :value="true"
              >
                <template v-slot:activator="{ props }">
                  <v-list-item
                    v-bind="props"
                    :value="area"
                    lines="one"
                    rounded="lg"
                    slim
                  >
                    <template #prepend>
                      <v-avatar>
                        <span style="height: 40px">
                          <CountryFlag :country="area" />
                        </span>
                      </v-avatar>
                    </template>

                    <template #title>
                      {{ country.findByIso2(area)?.name }}
                    </template>
                  </v-list-item>
                </template>

                <v-list-item
                  v-for="(node, i) in nodes"
                  :key="i"
                  :title="node.name"
                  :value="node.id"
                  rounded="lg"
                  slim
                  :lines="false"
                  @click="pingTag(node.id)"
                >
                  <template #append>
                    <Ping :tag="node.id" />
                  </template>
                </v-list-item>
              </v-list-group>
            </template>
          </template>
          
          <template v-else>
            <v-list-group
              v-for="[area, nodes] in Object.entries(areas)"
              :key="area"
              :value="area"
            >
              <template v-slot:activator="{ props }">
                <v-list-item
                  v-bind="props"
                  :value="area"
                  lines="one"
                  rounded="lg"
                  slim
                >
                  <template #prepend>
                    <v-avatar>
                      <span style="height: 40px">
                        <CountryFlag :country="area" />
                      </span>
                    </v-avatar>
                  </template>

                  <template #title>
                    {{ country.findByIso2(area)?.name }}
                  </template>
                </v-list-item>
              </template>

              <v-list-item
                v-for="(node, i) in nodes"
                :key="i"
                :title="node.name"
                :value="node.id"
                rounded="lg"
                slim
                :lines="false"
                @click="pingTag(node.id)"
              >
                <template #append>
                  <Ping :tag="node.id" />
                </template>
              </v-list-item>
            </v-list-group>
          </template>
        </v-list>
      </v-card-text>
    </Container>
  </div>
</template>
