<script setup lang="ts">
</script>

<template>
  <v-app>
    <v-app-bar
      density="comfortable"
      color="transparent"
      flat
      tile
    >
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
