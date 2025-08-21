<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import { useLocale } from "vuetify";

const { t } = useLocale();
const store = useStore()
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">{{ t('$vuetify.navigation.overview') }}</v-app-bar-title>
      </template>

      <v-card-text>
        Overview
        <pre>{{ store.routes }}</pre>
      </v-card-text>
    </Container>
  </div>
</template>
