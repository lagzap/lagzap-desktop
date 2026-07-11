<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import Europe from "~/components/icons/regions/europe.vue";
import country from "country-list-js";
import Ping from "~/components/network/Ping.vue";
import { useLocale } from "vuetify";
import { StartOptimizing } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import ContinentIcon from "~/components/icons/ContinentIcon.vue";
import type { Node, RelayRoute } from "~/bindings/github.com/lagzap/zap/data";
import { NodeFlag } from "~/bindings/github.com/lagzap/zap/data";

const locale = useLocale();
const { t } = locale;
const store = useStore();
const regions = computed(() => store.regions);
const filterMode = ref("all");

const showRouteDialog = ref(false)
const selectedNode = ref<Node | null>(null)
const selectedNodeRoutes = computed(() => {
  return store.routes[`${selectedNode.value?.id}-ipv4-udp`] || null
})
function showRoutes(node: Node) {
  selectedNode.value = node;
  showRouteDialog.value = true;
}

function hasRelayFlag(node: Node): boolean {
  return (node.flags & NodeFlag.NodeFlag_NODE_FLAG_RELAY) !== 0;
}

function getLowestPingForArea(nodes: Node[]): RelayRoute | null {
  let bestRoute: RelayRoute | null = null;
  let lowestLatency = Infinity;
  if (!nodes || nodes.length === 0) return null;

  const variants = ["ipv4-udp", "ipv4-tcp", "ipv6-udp", "ipv6-tcp"];

  for (const node of nodes) {
    // Only consider nodes with RELAY flag
    if (!hasRelayFlag(node)) continue;
    
    for (const v of variants) {
      const key = `${node.id}-${v}`;
      const routeData: RelayRoute | undefined = (store.routes || {})[key];
      if (
        !routeData ||
        !Array.isArray(routeData.routes) ||
        routeData.routes.length === 0
      )
        continue;

      for (const route of routeData.routes) {
        const l = route?.min_latency;
        if (
          typeof l === "number" &&
          !Number.isNaN(l) &&
          l > 0 &&
          l < lowestLatency
        ) {
          lowestLatency = l;
          bestRoute = routeData;
        }
      }
    }
  }

  return bestRoute;
}

function firstNodeIdForArea(nodes: Node[]): string {
  const relayNodes = nodes.filter(hasRelayFlag);
  return relayNodes && relayNodes.length > 0 ? relayNodes[0].id : "";
}

function getLowestPingForRegion(regionTag: string): RelayRoute | null {
  // flatten all areas in the region and find the best ping
  const regionAreas = areasByRegion.value[regionTag] || {};
  const nodes: Node[] = [];
  Object.values(regionAreas).forEach((arr) => nodes.push(...arr));
  if (nodes.length === 0) return null;
  
  // Filter to only RELAY nodes
  const relayNodes = nodes.filter(hasRelayFlag);
  if (relayNodes.length === 0) return null;
  
  return getLowestPingForArea(relayNodes);
}

const areas = computed(() => {
  const allNodes = Object.values(store.nodes)
    .slice()
    .filter(hasRelayFlag) // Only show nodes with RELAY flag
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

async function optimize() {
  await StartOptimizing();
}
</script>

<template>
  <div>
    <Container>
      <template v-if="false" #header>
        <v-tabs fixed-tabs>
          <v-tab :to="{ name: 'network-latency' }" :text="t('$vuetify.networkLatency.latencyGrid')" />
          <v-tab :to="{ name: 'network-map' }" :text="t('$vuetify.networkLatency.networkMap')" />
        </v-tabs>
        <v-spacer />
      </template>
      <template #header v-else>
        <v-app-bar-title class="text-subtitle-1">
          {{ t('$vuetify.networkLatency.latencyGrid') }}
        </v-app-bar-title>
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
                <ContinentIcon :tag="region.tag" />
              </v-avatar>
            </template>
            <span>{{ store.localized(region.name) }}</span>
            <template #append>
              <div class="ms-2">
                <Ping
                  v-if="getLowestPingForRegion(region.tag) !== null"
                  :tag="getLowestPingForRegion(region.tag).tag"
                />
              </div>
            </template>
          </v-chip>
        </v-chip-group>

        <v-row dense class="mb-16">
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
                        <span class="text-subtitle-1" style="line-height: 2.5">
                          {{ store.localized(nodes[0].city) }}
                        </span>
                      </template>
                      <template #append>
                        <Ping
                          v-if="getLowestPingForArea(nodes) !== null"
                          :tag="getLowestPingForArea(nodes).tag"
                        />
                        <Ping v-else :tag="firstNodeIdForArea(nodes)" />
                      </template>
                    </v-card>
                  </template>
                  <v-list>
                    <v-list-item
                      v-for="(node, i) in nodes"
                      :key="i"
                      :value="node.id"
                      @click="showRoutes(node)"
                    >
                      <v-list-item-title>
                        {{ store.localized(node.city) }}
                        {{ i + 1 }}
                      </v-list-item-title>
                      <template #append>
                        <Ping v-if="hasRelayFlag(node)" :tag="node.id" />
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
                      <span class="text-subtitle-1" style="line-height: 2.5">
                        {{ store.localized(nodes[0].city) }}
                      </span>
                    </template>
                    <template #append>
                      <Ping
                        v-if="getLowestPingForArea(nodes) !== null"
                        :tag="getLowestPingForArea(nodes).tag"
                      />
                      <Ping v-else :tag="firstNodeIdForArea(nodes)" />
                    </template>
                  </v-card>
                </template>
                <v-list>
                  <v-list-item
                    v-for="(node, i) in nodes"
                    :key="i"
                    :value="node.id"
                  >
                    <v-list-item-title>{{ node.name }}</v-list-item-title>
                    <template #append>
                      <Ping v-if="hasRelayFlag(node)" :tag="node.id" />
                    </template>
                  </v-list-item>
                </v-list>
              </v-menu>
            </v-col>
          </template>
        </v-row>
        <v-hover>
          <template #default="{ isHovering, props }">
            <v-fab
              prepend-icon="mdi-fire"
              appear
              size="large"
              color="primary"
              variant="elevated"
              v-bind="props"
              :style="{
                position: 'fixed',
                bottom: '16px',
                [locale.isRtl.value ? 'left' : 'right']: '16px',
                zIndex: 10000,
              }"
              text="Optimize"
              :loading="store.optimizing"
              @click="optimize()"
            />
          </template>
        </v-hover>
      </v-card-text>
    </Container>

    <v-dialog v-model:model-value="showRouteDialog" max-width="500">
      <template v-slot:default="{ isActive }">
        <v-card title="Dialog">
          <v-card-text>
            <pre>
              {{ selectedNodeRoutes }}
            </pre>
          </v-card-text>

          <v-card-actions>
            <v-spacer></v-spacer>

            <v-btn text="Close Dialog" @click="isActive.value = false"></v-btn>
          </v-card-actions>
        </v-card>
      </template>
    </v-dialog>
  </div>
</template>
