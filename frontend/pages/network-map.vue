<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import MapChart from "~/components/network/MapChart.vue";
import { useLocale } from "vuetify";

const selectedNode = ref<string | null>(null);

const { t } = useLocale();
</script>

<template>
  <Container>
    <template #header>
      <v-tabs fixed-tabs>
        <v-tab
          :to="{ name: 'monitoring' }"
          :text="t('$vuetify.networkLatency.latencyGrid')"
        />
        <v-tab
          :to="{ name: 'network-map' }"
          :text="t('$vuetify.networkLatency.networkMap')"
        />
      </v-tabs>

      <v-spacer />
    </template>

    <div :style="`height: ${$vuetify.display.height - 64}px; width: 100%`">
      <div :style="`height: ${$vuetify.display.height - 56}px; width: 100%`">
        <MapChart v-model="selectedNode" />
      </div>
    </div>
  </Container>
</template>
