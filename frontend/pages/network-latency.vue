<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import MiddleEast from "~/components/icons/regions/middle-east.vue";
import Europe from "~/components/icons/regions/europe.vue";
import country from "country-list-js";
import Ping from "~/components/Ping.vue";
import type {
  Node,
  RelayRoute,
} from "~/bindings/github.com/lagzap/lagzap/adapter";
import { useLocale } from "vuetify";

const locale = useLocale();
const { t } = locale;
const store = useStore();
const regions = computed(() => store.regions);
const filterMode = ref("all");

const echo = computed(() => store.routes || {});

function getLowestPingForArea(nodes: Node[]): RelayRoute | null {
  const pings = nodes
    .map((node) => echo.value[node.id])
    .filter((ping) => ping && ping.routes?.[0]?.min_latency > 0)
    .sort((a, b) => a.routes?.[0]?.min_latency - b.routes?.[0]?.min_latency);
  if (pings.length === 0) return null;
  return pings[0];
}

const areas = computed(() => {
  const allNodes = Object.values(store.nodes)
    .slice()
    .sort((a, b) => {
      const countryA = country.findByIso2(a.country)?.name || "";
      const countryB = country.findByIso2(b.country)?.name || "";
      return countryA.localeCompare(countryB);
    })
    .reduce((acc, node) => {
      const area = store.localized(node.city);
      acc[area] = acc[area] || [];
      acc[area].push(node);
      acc[area].sort((a, b) => a.name.localeCompare(b.name));

      return acc;
    }, {} as Record<string, Node[]>);

  if (filterMode.value !== "all") {
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
  if (filterMode.value !== "all") {
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

onMounted(async () => {
  await store.updateEcho();
});

async function pingTag(tag: string) {
  const latency = await store.pingNode(tag);
  console.log(latency);
}
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">{{
          t("$vuetify.navigation.networkLatency")
        }}</v-app-bar-title>
      </template>
      <v-card-text>
        <v-chip-group
          v-model="filterMode"
          color="primary"
          class="mb-3"
          filter
          mandatory
          show-arrows
        >
          <v-chip rounded size="large" value="all">
            <span>{{ t("$vuetify.network.allRegions") }}</span>
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
                  v-if="region.tag == 'eu'"
                  src="~/assets/svgs/regions/europe.svg"
                />
                <MiddleEast
                  v-else-if="region.tag == 'me'"
                  src="~/assets/svgs/regions/middle-east.svg"
                />
              </v-avatar>
            </template>
            <span>{{ store.localized(region.name) }}</span>
          </v-chip>
        </v-chip-group>

        <v-row dense>
          <template v-if="filterMode === 'all'">
            <template
              v-for="[regionTag, regionAreas] in Object.entries(areasByRegion)"
              :key="regionTag"
            >
              <v-col cols="12" class="py-0">
                <v-list-subheader>
                  {{
                    store.localized(
                      Object.values(regions).find(
                        (r: any) => r.tag === regionTag
                      )?.name
                    )
                  }}
                </v-list-subheader>
              </v-col>
              <v-col
                v-for="[area, nodes] in Object.entries(regionAreas)"
                :key="area"
                cols="12"
                sm="6"
                md="4"
                lg="3"
                xl="2"
              >
                <v-menu
                  open-on-hover
                  :offset="10"
                  :close-on-content-click="false"
                >
                  <template #activator="{ props }">
                    <v-card v-bind="props">
                      <template #prepend>
                        <v-avatar>
                          <span style="height: 40px">
                            <CountryFlag :country="nodes[0].country" />
                          </span>
                        </v-avatar>
                      </template>
                      <template #title>
                        <span
                          class="text-subtitle-1"
                          style="line-height: 2.5"
                          >{{ store.localized(nodes[0].city) }}</span
                        >
                      </template>
                      <template #append>
                        <Ping
                          v-if="getLowestPingForArea(nodes) !== null"
                          :tag="getLowestPingForArea(nodes).tag"
                        />
                      </template>
                    </v-card>
                  </template>
                  <v-list>
                    <v-list-item
                      v-for="(node, i) in nodes"
                      :key="i"
                      :value="node.id"
                      @click="pingTag(node.id)"
                    >
                      <v-list-item-title
                        >{{ store.localized(node.city) }}
                        {{ i + 1 }}</v-list-item-title
                      >
                      <template #append>
                        <Ping :tag="node.id" />
                      </template>
                    </v-list-item>
                  </v-list>
                </v-menu>
              </v-col>
            </template>
          </template>
          <template v-else>
            <v-col
              v-for="[area, nodes] in Object.entries(areas)"
              :key="area"
              cols="12"
              sm="6"
              md="4"
              lg="3"
              xl="2"
            >
              <v-menu open-on-hover location="center">
                <template #activator="{ props }">
                  <v-card v-bind="props">
                    <template #prepend>
                      <v-avatar>
                        <span style="height: 40px">
                          <CountryFlag :country="nodes[0].country" />
                        </span>
                      </v-avatar>
                    </template>
                    <template #title>
                      {{ store.localized(nodes[0].city) }}
                    </template>
                    <template #append>
                      <Ping
                        v-if="getLowestPingForArea(nodes) !== null"
                        :tag="getLowestPingForArea(nodes).tag"
                      />
                    </template>
                  </v-card>
                </template>
                <v-list>
                  <v-list-item
                    v-for="(node, i) in nodes"
                    :key="i"
                    :value="node.id"
                    @click="pingTag(node.id)"
                  >
                    <v-list-item-title>{{ node.name }}</v-list-item-title>
                    <template #append>
                      <Ping :tag="node.id" />
                    </template>
                  </v-list-item>
                </v-list>
              </v-menu>
            </v-col>
          </template>
        </v-row>
        <v-fab
          icon
          appear
          size="x-large"
          color="lime"
          variant="elevated"
          :style="{
            position: 'fixed',
            bottom: '16px',
            [locale.isRtl.value ? 'left' : 'right']: '16px',
            zIndex: 10000,
          }"
          :loading="store.optimizing"
          @click="store.optimize()"
        >
          <v-icon>mdi-auto-fix</v-icon>
        </v-fab>
      </v-card-text>
    </Container>
  </div>
</template>
