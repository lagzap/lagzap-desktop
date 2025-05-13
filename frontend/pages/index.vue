<script setup lang="ts">
import { DeviceHash } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import Container from "~/components/layout/Container.vue";

const deviceHash = await DeviceHash()
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title>Overview</v-app-bar-title>
      </template>

      <v-card-text>
        Device hash: {{ deviceHash }}
      </v-card-text>
    </Container>
  </div>
</template>
