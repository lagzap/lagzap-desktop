<script setup lang="ts">
import { useStore } from "@/stores";
import { useLocale } from "vuetify";

const { t } = useLocale();
const store = useStore();
const recentTitles = computed(() => store.getRecentTitles);
</script>

<template>
  <v-list nav density="compact" color="tertiary">
    <v-list-subheader>{{ t('$vuetify.navigation.quickAccess') }}</v-list-subheader>
    <v-list-item
      v-for="title in recentTitles"
      :key="`title-${title.id}`"
      :title="store.localized(title.name)"
      :to="{ name: 'title-id', params: { id: title.id } }"
      rounded="xl"
      lines="one"
    >
      <template #prepend>
        <v-avatar :size="32" :image="title.icon_url" />
      </template>

      <template #append>
        <v-tooltip :text="store.isTitleActive(title.id) ? (store.ndisRunning ? t('$vuetify.status.active') : t('$vuetify.status.serviceNotRunning')) : t('$vuetify.status.inactive')">
          <template v-slot:activator="{ props }">
            <v-btn
              v-bind="props"
              :color="store.isTitleActive(title.id) ? 'green' : 'secondary'"
              :icon="store.ndisRunning ? 'mdi-circle-medium' : 'mdi-circle-small'"
              variant="text"
              size="md"
              :disabled="!store.connected"
              @click.stop.prevent="store.toggleTitleState(title)"
            />
          </template>
        </v-tooltip>
      </template>
    </v-list-item>
  </v-list>
</template>
