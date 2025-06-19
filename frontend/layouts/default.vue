<script setup lang="ts">
import {useDisplay} from "vuetify";
import NavigationDrawer from "~/components/layout/NavigationDrawer.vue";

const {mobile} = useDisplay();
const sidebar = ref(!mobile.value);
provide("sidebar", sidebar);

const store = useStore();
const optimizing = computed(() => store.optimizing);
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
              indeterminate="disable-shrink"
              size="16"
              width="2"
              class="ms-3"
            />
          </template>
        </v-card>
      </v-scale-transition>
    </div>
  </v-app>
</template>
