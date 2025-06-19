<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import { useStore } from "@/stores";

const store = useStore();
const route = useRoute();
const data = useSanctumUser<DataResponse>();

const title = computed(() => store.titles[route.params.id as string]);

onMounted(() => {
  nextTick(() => {
    if (!title.value) {
      return;
    }
    store.visitTitle(title.value.id);
  });
});
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-avatar v-if="title?.icon_url" density="comfortable">
          <v-img :src="title?.icon_url" />
        </v-avatar>
        <v-app-bar-title>{{ title?.name }}</v-app-bar-title>

        <v-btn
          variant="plain"
          color="secondary"
          prepend-icon="mdi-bug-outline"
          text="Report"
        />
      </template>

      <NuxtPage
        :transition="{
          name: 'slide-x-transition',
          mode: 'in-out',
          persisted: true
        }"
      />

      <template v-if="title" #outside>
        <v-fab
          v-if="store.isTitleActive(title.id)"
          :active="route.name === 'title-id'"
          icon
          appear
          size="x-large"
          color="green"
          variant="elevated"
          style="position: fixed; bottom: 16px; right: 16px; z-index: 10000"
          @click="store.toggleActiveState(title)"
        >
          <v-icon>mdi-pause</v-icon>
        </v-fab>
        <v-fab
          v-else
          :active="route.name === 'title-id'"
          icon
          appear
          size="x-large"
          color="accent"
          variant="elevated"
          style="position: fixed; bottom: 16px; right: 16px; z-index: 10000"
          @click="store.toggleActiveState(title)"
        >
          <v-icon>mdi-play</v-icon>
        </v-fab>
      </template>
    </Container>
  </div>
</template>
