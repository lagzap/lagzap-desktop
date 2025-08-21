<script setup lang="ts">
import { useLocale } from "vuetify";
import Container from "~/components/layout/Container.vue";
import General from "~/components/settings/General.vue";
import NetworkAdapter from "~/components/settings/NetworkAdapter.vue";
import Routing from "~/components/settings/Routing.vue";

const locale = useLocale();
const { t } = locale
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          {{ t('$vuetify.settings.title') }}
        </v-app-bar-title>
      </template>
      <General  />
      <v-divider class="mx-4" />
      <NetworkAdapter  />
      <v-divider class="mx-4" />
      <Routing  />
    </Container>
  </div>
</template>
