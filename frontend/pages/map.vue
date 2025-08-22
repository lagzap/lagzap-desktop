<script setup lang="ts">
import { ref, computed } from "vue";
import { useStore } from "~/stores";
import Container from "~/components/layout/Container.vue";
import MapChart from "~/components/MapChart.vue";

const store = useStore();

const selectedNode = ref<string | null>(null);

const nodesList = computed(() => {
  return Object.values(store.nodes || {}).sort((a: any, b: any) =>
    (a.name || "").localeCompare(b.name)
  );
});
</script>

<template>
  <Container>
    <template #header>
      <v-tabs fixed-tabs>
        <v-tab :to="{ name: 'network-latency' }" text="Latency Grid" />
        <v-tab :to="{ name: 'map' }" text="Network Map" />
      </v-tabs>

      <v-spacer />
    </template>

    <div :style="`height: ${$vuetify.display.height - 64}px; width: 100%`">
      <v-toolbar
        v-if="false"
        rounded="lg"
        floating
        class="position-absolute"
        color="transparent"
        style="z-index: 1000; margin-top: 1rem; margin-left: 1rem"
      >
        <div class="px-4">
          <v-select
            v-model="selectedNode"
            :items="nodesList"
            item-text="name"
            item-value="id"
            label="Select a node"
            hide-details
            variant="solo"
            min-width="200px"
            flat
          />
        </div>
      </v-toolbar>
      <div :style="`height: ${$vuetify.display.height - 56}px; width: 100%`">
        <MapChart v-model="selectedNode" />
      </div>
    </div>
  </Container>
</template>
