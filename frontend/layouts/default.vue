<script setup lang="ts">
import { NuxtPage } from "#components";
import { useDisplay } from "vuetify";
import NavigationDrawer from "~/components/layout/NavigationDrawer.vue";

const { mobile } = useDisplay();
const sidebar = ref(!mobile.value);
provide("sidebar", sidebar);

const store = useStore();

import { onMounted } from "vue";
import { useStore } from "@/stores";
import { GetNodes, GetProfiles, GetProfileStates, GetRegions, GetRoutes, GetRoutes2, GetTitles, GetTitleStates } from "~/bindings/github.com/lagzap/lagzap-desktop/service";

// Helper to check if an object is empty
function isEmpty(obj: any) {
  return !obj || (typeof obj === "object" && Object.keys(obj).length === 0);
}

onMounted(async () => {
  if (isEmpty(store.regions)) {
    const data = await GetRegions();
    store.regions = data
  }

  if (isEmpty(store.titles)) {
    const data = await GetTitles();
    store.titles = Object.values(data)
  }

  if (isEmpty(store.profiles)) {
    const data = await GetProfiles();
    store.profiles = Object.values(data)
  }

  if (isEmpty(store.titleStates)) {
    const data = await GetTitleStates();
    store.titleStates = data
  }

  if (isEmpty(store.profileStates)) {
    const data = await GetProfileStates();
    store.profileStates = data
  }

  if (isEmpty(store.nodes)) {
    const data = await GetNodes();
    store.nodes = data
  }

  if (isEmpty(store.routes)) {
    const data = await GetRoutes();
    store.routes = data
  }
});

</script>

<template>
  <v-app>
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
        :subtitle="store.optimizeProgress.total_tests ? `${store.optimizeProgress.completed_tests || 0} / ${
          store.optimizeProgress.total_tests || 0
        }` : 'Initializing'"
        variant="elevated"
      >
        <template v-slot:prepend>
          <v-avatar>
            <CyrexLogo />
          </v-avatar>
        </template>

        <template #title>
          <span class="text-subtitle-1">Advanced Route Analysis</span>
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
              :indeterminate="store.optimizeProgress.total_tests === 0 || store.optimizeProgress.progress === 100 || store.optimizeProgress.progress === 0"
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
