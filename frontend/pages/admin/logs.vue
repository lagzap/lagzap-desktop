<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import { useLocale } from "vuetify";

const { t } = useLocale()
const { logs } = useMonitoringStore();

logs.value = logs.value.slice(0, 100)

const search = ref<string>("");

const filteredItems = computed(() => {
  if (!search.value) return logs.value;
  return logs.value.filter((log: any) => 
    JSON.stringify(log).toLowerCase().includes(search.value.toLowerCase())
  );
});

const getLogLevelColor = (level: string) => {
  switch (level?.toLowerCase()) {
    case 'panic': return 'red-darken-4';
    case 'fatal': return 'red-darken-2';
    case 'error': return 'error';
    case 'warning': case 'warn': return 'warning';
    case 'info': return 'info';
    case 'debug': return 'primary';
    case 'trace': return 'blue-grey';
    default: return 'grey';
  }
}
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">{{ t('$vuetify.navigation.connections') }}</v-app-bar-title>
      </template>
      <v-toolbar class="bg-transparent px-3">
        <v-text-field
          v-model:model-value="search"
          variant="solo-filled"
          rounded="xl"
          density="compact"
          :label="t('$vuetify.common.search')"
          prepend-inner-icon="mdi-magnify"
          hide-details
          single-line
          style="width: 200px"
        />
      </v-toolbar>
      <v-virtual-scroll
        :height="$vuetify.display.height - 120"
        :items="filteredItems"
        class="mx-2"
      >
        <template v-slot:default="{ item }">
          <v-card variant="text" density="compact" class="my-1 py-0">
            <template #title>
              <v-chip
                size="x-small"
                class="mr-2"
                :color="getLogLevelColor(item.type)"
              >
                {{ item.type.toUpperCase() || 'INFO' }}
              </v-chip>
              <span class="text-caption text-medium-emphasis me-2">
                {{ new Date(item.time || Date.now()).toLocaleString() }}
              </span>
            </template>
            <v-card-text class="pt-0 pb-1">
              <div class="text-body-2 font-weight-medium mb-1 selectable">
                {{ item.payload || 'No message' }}
              </div>
              
            </v-card-text>
          </v-card>
        </template>
      </v-virtual-scroll>
    </Container>
  </div>
</template>