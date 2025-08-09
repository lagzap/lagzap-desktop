<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">Gaming Consoles</v-app-bar-title>
      </template>
      <v-card-text>
        <v-card
          title="PlayStation 4"
          subtitle="Coming soon"
          prepend-icon="mdi-sony-playstation"
          append-icon="mdi-chevron-right"
          class="mb-3"
          disabled
        />
        <v-card
          title="PlayStation 5"
          subtitle="Coming soon"
          prepend-icon="mdi-sony-playstation"
          append-icon="mdi-chevron-right"
          class="mb-3"
          disabled
        />
        <v-card
          title="Xbox Series S"
          subtitle="Coming soon"
          prepend-icon="mdi-microsoft-xbox"
          append-icon="mdi-chevron-right"
          class="mb-3"
          disabled
        />
        <v-card
          title="Xbox Series X"
          subtitle="Coming soon"
          prepend-icon="mdi-microsoft-xbox"
          append-icon="mdi-chevron-right"
          class="mb-3"
          disabled
        />
        <v-card
          title="Nintendo Switch"
          subtitle="Coming soon"
          prepend-icon="mdi-nintendo-switch"
          append-icon="mdi-chevron-right"
          class="mb-3"
          disabled
        />
        <v-card
          title="Steam Deck"
          subtitle="Coming soon"
          prepend-icon="mdi-steam"
          append-icon="mdi-chevron-right"
          class="mb-3"
          disabled
        />
      </v-card-text>
    </Container>
  </div>
</template>
