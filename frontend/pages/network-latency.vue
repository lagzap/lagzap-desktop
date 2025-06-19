<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import MiddleEast from "~/components/icons/regions/middle-east.vue";
import Europe from "~/components/icons/regions/europe.vue";
import country from "country-list-js";
import { PingOutbound } from "~/bindings/github.com/lagzap/lagzap-desktop/service";

const store = useStore();

onMounted(async () => await store.updateLatency());

const regions = computed(() => store.regions);
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
const latencies = computed(() => store.nodeLatencies);

const loading = ref(false);
async function pingAll() {
  loading.value = true;
  await store.optimize()
  loading.value = false;
}

async function pingArea(area: string, value: any) {
  const nodes = areas.value[area];
  nodes.forEach(async (node) => {
    const data = await PingOutbound(node.id);
    Object.keys(data).forEach((key) => {
      store.setNodeLatency(node.id, data[key]);
    });
  });
}

async function pingNode(nodeId: string) {
  const data = await PingOutbound(nodeId);
  Object.keys(data).forEach((key) => {
    store.setNodeLatency(nodeId, data[key]);
  });
}
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title>Network Latency</v-app-bar-title>

        <v-spacer />
        <v-btn variant="plain" :loading="loading" @click="pingAll">
          Optimize
        </v-btn>
      </template>
      <v-card-text>
        <v-expansion-panels variant="accordion">
          <v-expansion-panel
            v-for="region in regions"
            :key="region.tag"
            :disabled="region.active === false"
          >
            <v-expansion-panel-title disable-icon-rotate>
              <v-avatar size="32">
                <Europe
                  v-if="region.tag == 'europe'"
                  src="~/assets/svgs/regions/europe.svg"
                />
                <MiddleEast
                  v-else-if="region.tag == 'middle-east'"
                  src="~/assets/svgs/regions/middle-east.svg"
                />
              </v-avatar>
              <span class="ms-3">
                {{ region.name }}

                <Ping :latency="latencies[region.tag]?.min_latency ?? null" />
              </span>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <v-list>
                <v-list-group
                  v-for="[area, nodes] in Object.entries(areas).filter(([, nodes]) => nodes[0].region === region.tag)"
                  :key="area"
                  :value="area"
                >
                  <template v-slot:activator="{ props }">
                    <v-list-item
                      v-bind="props"
                      :value="area"
                      lines="two"
                      rounded="lg"
                      @click.stop="pingArea(area, $event)"
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

                      <template #subtitle>
                        <Ping :latency="latencies[area]?.min_latency ?? null" />
                      </template>
                    </v-list-item>
                  </template>

                  <v-list-item
                    v-for="(node, i) in nodes"
                    :key="i"
                    :title="node.name"
                    :value="node.id"
                    rounded="lg"
                    :lines="false"
                    @click.stop="pingNode(node.id)"
                  >
                    <template #append>
                      <Ping :latency="latencies[node.id]?.min_latency ?? null" />
                    </template>
                  </v-list-item>
                </v-list-group>
              </v-list>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>
    </Container>
  </div>
</template>
