<script setup lang="ts">
import { useLocale } from "vuetify";
import Container from "~/components/layout/Container.vue";
import TitleFavoriteButton from "~/components/title/TitleFavoriteButton.vue";

const locale = useLocale();
const { t } = locale;
const store = useStore();
const titles = computed(() => store.getTitles);
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          {{ t("$vuetify.navigation.titles") }}
        </v-app-bar-title>
      </template>

      <v-card-text class="mb-16">
        <v-data-iterator :items="titles" :items-per-page="titles.length">
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
                  class="py-1 mb-1 titles-card"
                >
                  <v-list-item
                    :prepend-avatar="item.raw.icon_url"
                    :title="store.localized(item.raw.name)"
                  >
                    <template #append>
                      <div class="d-flex align-center">
                        <span class="titles-card__fav">
                          <TitleFavoriteButton :title-id="item.raw.id" />
                        </span>
                        <v-tooltip
                          :text="
                            store.isTitleActive(item.raw.id)
                              ? store.ndisRunning
                                ? t('$vuetify.title.active')
                                : t('$vuetify.title.serviceStopped')
                              : t('$vuetify.title.inactive')
                          "
                        >
                          <template #activator="{ props }">
                            <v-btn
                              v-bind="props"
                              :color="
                                store.isTitleActive(item.raw.id)
                                  ? 'green'
                                  : 'secondary'
                              "
                              :icon="
                                store.ndisRunning
                                  ? 'mdi-circle-medium'
                                  : 'mdi-circle-small'
                              "
                              variant="text"
                              size="md"
                              :disabled="!store.appReady"
                              @click.stop.prevent="
                                store.toggleTitleState(item.raw)
                              "
                            />
                          </template>
                        </v-tooltip>
                      </div>
                    </template>
                  </v-list-item>
                </v-card>
              </v-col>
            </v-row>
          </template>
        </v-data-iterator>
      </v-card-text>

      <template #outside>
        <v-fab
          appear
          size="large"
          color="info"
          variant="elevated"
          prepend-icon="mdi-plus"
          :style="{
            position: 'fixed',
            bottom: '24px',
            [locale.isRtl.value ? 'left' : 'right']: '24px',
            zIndex: 10000,
          }"
          :disabled="!store.appReady"
          text="Request Title"
        />
      </template>
    </Container>
  </div>
</template>

<style scoped>
.titles-card__fav {
  display: inline-flex;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.titles-card:hover .titles-card__fav,
.titles-card:focus-within .titles-card__fav {
  opacity: 1;
  pointer-events: auto;
}
</style>
