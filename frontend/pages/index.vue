<script setup lang="ts">
import { GetEchoResults, FetchData } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { NodeEchoResult } from "~/bindings/github.com/lagzap/lagzap/adapter";
import Container from "~/components/layout/Container.vue";

const tests = ref<Record<string, NodeEchoResult>>({});

async function loadRegions() {
  const regions = await FetchData();
  console.log(regions);
}
async function loadTests() {
  tests.value = await GetEchoResults();
  console.log(tests.value);
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
      </v-card-text>
    </Container>
  </div>
</template>
