<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import General from "~/components/settings/General.vue";
import NetworkAdapter from "~/components/settings/NetworkAdapter.vue";

</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title>
          Settings
        </v-app-bar-title>
      </template>
      <General  />
      <NetworkAdapter  />
    </Container>
  </div>
</template>
