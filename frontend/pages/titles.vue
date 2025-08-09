<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import { useLocale } from "vuetify";

const locale = useLocale();
const { t } = locale
const store = useStore();
const titles = computed(() => store.getTitles);
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          {{ t('$vuetify.navigation.titles') }}
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
                    :title="store.localized(item.raw.name)"
                  >
                    <template #append>
                      <v-tooltip
                        :text="store.isTitleActive(item.raw.id) ? (store.ndisRunning ? t('$vuetify.title.active') : t('$vuetify.title.serviceStopped')) : t('$vuetify.title.inactive')">
                        <template #activator="{ props }">
                          <v-btn
                            v-bind="props"
                            :color="store.isTitleActive(item.raw.id) ? 'green' : 'secondary'"
                            :icon="store.ndisRunning ? 'mdi-circle-medium' : 'mdi-circle-small'"
                            variant="text"
                            size="md"
                            :disabled="!store.connected"
                            @click.stop.prevent="store.toggleTitleState(item.raw)"
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
          :style="{
            position: 'fixed',
            bottom: '24px',
            [locale.isRtl.value ? 'left' : 'right']: '24px',
            zIndex: 10000
          }"
          :disabled="!store.connected"
        >
          <v-icon>
            mdi-plus
          </v-icon>
        </v-fab>
      </template>
    </Container>
  </div>
</template>
