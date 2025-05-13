<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import MiddleEast from "~/components/icons/regions/middle-east.vue";
import Europe from "~/components/icons/regions/europe.vue";
import country from "country-list-js";

import {
  GetLatency,
  PingOutbound,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";

const store = useStore();

onMounted(async () => {
  await store.updateLatency();
});

const regions = computed(() => store.regions);
const areas = computed(() => {
  return store.nodes
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
  await GetLatency(true);
  await store.updateLatency();
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
      <v-expansion-panels variant="popout" class="mt-5">
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
              <template v-for="(nodes, area) in areas" :key="area">
                <v-list-item
                  v-if="nodes[0].region == region.tag"
                  :value="area"
                  lines="two"
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

                  <template #subtitle> {{ nodes.length }} servers </template>

                  <template #append>
                    <Ping :latency="latencies[area]?.min_latency ?? null" />
                  </template>
                </v-list-item>
              </template>
            </v-list>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </Container>
  </div>
</template>
