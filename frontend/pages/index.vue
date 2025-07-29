<script setup lang="ts">
import { StartOptimizing, FetchData } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { NodeOptimizeResult } from "~/bindings/github.com/lagzap/lagzap/adapter";
import Container from "~/components/layout/Container.vue";

const store = useStore()
const tests = ref<Record<string, NodeOptimizeResult>>({});

async function loadRegions() {
  const regions = await FetchData();
  console.log(regions);
}
async function loadTests() {
  await StartOptimizing()
}
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title>Overview</v-app-bar-title>

        <v-spacer />
        <v-btn @click="loadRegions">
          Load Regions
        </v-btn>
        <v-btn @click="loadTests">
          Load Tests
        </v-btn>
      </template>

      <v-card-text>
        <pre>{{ tests }}</pre>
        <pre>{{ store.nodes }}</pre>
      </v-card-text>
    </Container>
  </div>
</template>
