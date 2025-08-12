<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import { useLocale } from "vuetify";
import { GetOptimizeResults } from "~/bindings/github.com/lagzap/lagzap-desktop/service";

const { t } = useLocale();
const optimizeResults = ref({});
optimizeResults.value = await GetOptimizeResults()
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">{{ t('$vuetify.navigation.overview') }}</v-app-bar-title>
      </template>

      <v-card-text>
        <pre>{{ optimizeResults }}</pre>
      </v-card-text>
    </Container>
  </div>
</template>
