<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import { useLocale } from "vuetify";

const { t } = useLocale();
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">{{ t('$vuetify.navigation.overview') }}</v-app-bar-title>
      </template>

      <v-card-text>
        Nothing yet
      </v-card-text>
    </Container>
  </div>
</template>
