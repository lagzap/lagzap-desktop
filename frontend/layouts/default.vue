<script setup lang="ts">
import {useDisplay} from "vuetify";
import NavigationDrawer from "~/components/layout/NavigationDrawer.vue";

const {mobile} = useDisplay();
const sidebar = ref(!mobile.value);
provide("sidebar", sidebar);
</script>

<template>
  <v-app full-height>
    <NavigationDrawer v-model="sidebar"/>

    <slot/>
  </v-app>
</template>
