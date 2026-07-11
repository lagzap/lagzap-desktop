<script setup lang="ts">
import Settings from '~/components/dialog/Settings.vue';
import Language from '~/components/dialog/Language.vue';
import Theme from '~/components/dialog/Theme.vue';

const settingsDialog = ref(false);
const languageDialog = ref(false);
const themeDialog = ref(false);
</script>

<template>
  <v-app>
    <v-app-bar
      density="comfortable"
      color="transparent"
      flat
      tile
    >
      <Language v-model="languageDialog" />
      <Theme v-model="themeDialog" />
      <Settings v-model="settingsDialog" />
      <v-spacer />
    </v-app-bar>

    <v-main>
      <v-container class="h-100">
        <div class="d-flex align-center justify-center h-100">
          <slot />
        </div>
      </v-container>
    </v-main>
  </v-app>
</template>
