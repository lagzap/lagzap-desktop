<script setup lang="ts">
import { NuxtPage } from "#components";
import { useDisplay } from "vuetify";
import NavigationDrawer from "~/components/layout/NavigationDrawer.vue";

const { mobile } = useDisplay();
const sidebar = ref(!mobile.value);
provide("sidebar", sidebar);

const store = useStore();
</script>

<template>
  <v-app full-height>
    <NavigationDrawer v-model="sidebar" />

    <NuxtPage
      :transition="{
        name: 'zoom-transition',
        mode: 'in-out',
        type: 'transition',
        persisted: true,
      }"
    />

    <v-dialog
      :model-value="store.optimizing"
      persistent
      scrim
      max-width="500"
      style="--wails-draggable: drag"
    >
      <v-card
        v-show="store.optimizing"
        density="compact"
        title="Optimizing"
        :subtitle="`${store.optimizeProgress.completed_tests || 0} / ${
          store.optimizeProgress.total_tests || 0
        }`"
        variant="elevated"
      >
        <template v-slot:prepend>
          <v-avatar>
            <LagzapLogo />
          </v-avatar>
        </template>

        <template v-slot:append>
          <v-scale-transition leave-absolute>
            <v-progress-circular
              v-if="store.optimizeProgress.progress <= 100"
              color="primary"
              size="24"
              width="2"
              class="ms-3"
              :model-value="store.optimizeProgress.progress"
            />
            <v-icon
              v-else-if="store.optimizeProgress.progress === 100"
              color="green"
            >
              mdi-check-circle
            </v-icon>
          </v-scale-transition>
        </template>
      </v-card>
    </v-dialog>
  </v-app>
</template>
