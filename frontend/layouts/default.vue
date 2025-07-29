<script setup lang="ts">
import {useDisplay} from "vuetify";
import { Events } from "@wailsio/runtime";
import NavigationDrawer from "~/components/layout/NavigationDrawer.vue";

const {mobile} = useDisplay();
const sidebar = ref(!mobile.value);
provide("sidebar", sidebar);

const store = useStore();
const optimizing = ref(false);

const progress = ref(0)
Events.On("echo_progress", ({ data }) => {
  const progress = data[0]
  optimizing.value = progress.progress_percentage > 0 && progress.progress_percentage < 100
  progress.value = progress.progress_percentage
});
</script>

<template>
  <v-app full-height>
    <NavigationDrawer v-model="sidebar"/>

    <slot/>

    <div class="position-fixed d-flex flex-column align-center justify-center" style="bottom: 2rem; left: 0; right: 0; z-index: 2000">
      <v-scale-transition leave-absolute>
        <v-card
          v-show="optimizing"
          density="compact"
          title="Optimizing"
          variant="text"
        >
          <template v-slot:prepend>
            <v-avatar>
              <LagzapLogo />
            </v-avatar>
          </template>

          <template v-slot:append>
            <v-progress-circular
              color="primary"
              size="16"
              width="2"
              class="ms-3"
              :value="progress"
            />
          </template>
        </v-card>
      </v-scale-transition>
    </div>
  </v-app>
</template>
