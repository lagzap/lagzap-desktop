<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import type { Title } from "~/bindings/github.com/lagzap/lagzap/adapter";

const store = useStore();
const titles = computed(() => store.getTitles);
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title>
          Apps & Games
        </v-app-bar-title>
      </template>

      <v-card
        class="my-3 px-3 bg-transparent"
        flat
      >
        <v-data-iterator
          :items="titles"
          :items-per-page="titles.length"
        >
          <template #default="{ items }">
            <v-row dense>
              <v-col
                v-for="(item, i) in items"
                :key="i"
                cols="12"
                sm="6"
                md="6"
                lg="4"
                xl="3"
              >
                <v-card
                  :to="{ name: 'title-id', params: { id: item.raw.id } }"
                  class="py-1 mb-1"
                >
                  <v-list-item
                    :prepend-avatar="item.raw.icon_url"
                    :title="item.raw.name"
                  >
                    <template #append>
                      <v-tooltip
                        :text="store.isTitleActive(item.raw.id) ? (store.ndisRunning ? 'Active' : 'Service is not running') : 'Inactive'">
                        <template #activator="{ props }">
                          <v-btn
                            v-bind="props"
                            :color="store.isTitleActive(item.raw.id) ? 'green' : 'secondary'"
                            :icon="store.ndisRunning ? 'mdi-circle-medium' : 'mdi-circle-small'"
                            variant="text"
                            size="md"
                            @click.stop.prevent="store.toggleActiveState(item.raw)"
                          />
                        </template>
                      </v-tooltip>
                    </template>
                  </v-list-item>
                </v-card>
              </v-col>
            </v-row>
          </template>
        </v-data-iterator>
      </v-card>

      <template #outside>
        <v-fab
          icon
          appear
          size="x-large"
          color="info"
          variant="elevated"
          style="position: fixed; bottom: 16px; right: 16px; z-index: 10000"
        >
          <v-icon>
            mdi-plus
          </v-icon>
        </v-fab>
      </template>
    </Container>
  </div>
</template>
