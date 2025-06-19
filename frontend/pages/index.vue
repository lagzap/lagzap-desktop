<script setup lang="ts">
import { GetRegions } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import Container from "~/components/layout/Container.vue";

async function loadRegions() {
  const regions = await GetRegions();
  console.log(regions);
}
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title>Overview</v-app-bar-title>
      </template>

      <v-card-text>
        Nothing yet.
        <v-btn @click="loadRegions">
          Load Regions
        </v-btn>
      </v-card-text>
    </Container>
  </div>
</template>
