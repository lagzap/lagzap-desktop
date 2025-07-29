<script setup lang="ts">
import { useStore } from "@/stores";

const store = useStore();
const recentTitles = computed(() => store.getRecentTitles);
</script>

<template>
  <v-list nav density="compact">
    <v-list-subheader> Quick Access </v-list-subheader>
    <v-list-item
      v-for="title in recentTitles"
      :key="`title-${title.id}`"
      :title="title.name"
      :to="{ name: 'title-id', params: { id: title.id } }"
      rounded="xl"
      lines="one"
    >
      <template #prepend>
        <v-avatar color="black" :size="32" :image="title.icon_url" />
      </template>

      <template #append>
        <v-tooltip :text="store.isTitleActive(title.id) ? (store.ndisRunning ? 'Active' : 'Service is not running') : 'Inactive'">
          <template v-slot:activator="{ props }">
            <v-btn
              v-bind="props"
              :color="store.isTitleActive(title.id) ? 'green' : 'secondary'"
              :icon="store.ndisRunning ? 'mdi-circle-medium' : 'mdi-circle-small'"
              variant="text"
              size="md"
              @click.stop.prevent="store.toggleActiveState(title)"
            />
          </template>
        </v-tooltip>
      </template>
    </v-list-item>
  </v-list>
</template>
