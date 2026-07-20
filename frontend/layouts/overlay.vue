<script setup lang="ts">
import { useLocale, useTheme } from "vuetify";

const locale = useLocale();
const theme = useTheme();
const { loadSettings } = useSettings(locale, theme);

await loadSettings();
</script>

<template>
  <v-app class="overlay-layout">
    <v-main class="overlay-layout__main">
      <slot />
    </v-main>
  </v-app>
</template>

<style scoped>
.overlay-layout {
  background: transparent !important;
  height: 100%;
}

.overlay-layout__main {
  --v-layout-top: 0px !important;
  padding: 0 !important;
  height: 100%;
  background: transparent;
}
</style>
