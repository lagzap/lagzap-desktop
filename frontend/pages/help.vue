<script setup lang="ts">
import Container from "~/components/layout/Container.vue";

const content = ref('')
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title>
          Help & Support
        </v-app-bar-title>
      </template>

      <v-card-text>
        <div v-html="content"/>
      </v-card-text>
    </Container>
  </div>
</template>
