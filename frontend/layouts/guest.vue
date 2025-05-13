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
          <v-card
            max-height="80vh"
            width="450px"
            class="zoom-in"
          >
            <slot />
          </v-card>
        </div>
      </v-container>
    </v-main>
  </v-app>
</template>

<style lang="scss" scoped>
.zoom-in {
  animation: animate-zoom-in 0.5s cubic-bezier(0.05, 0.7, 0.1, 1.0) forwards;
}

@keyframes animate-zoom-in {
  0% {
    opacity: 0;
    transform: scale(.7);
  }

  100% {
    opacity: 1;
    transform: scale(1);
  }
}
</style>
