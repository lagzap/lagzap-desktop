<script setup lang="ts">
import { useLocale } from "vuetify";
import Container from "~/components/layout/Container.vue";
import TitleFavoriteButton from "~/components/title/TitleFavoriteButton.vue";
import TitleAvatar from "~/components/plan/TitleAvatar.vue";
import PlanLock from "~/components/plan/PlanLock.vue";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { localDigits } from "~/utils/localeFormat";
import { useSettings } from "~/composables/useSettings";
import {
  CATEGORY_ALL,
  CATEGORY_UNCATEGORIZED,
  titleCategoryIcon,
  useTitleCategories,
} from "~/composables/useTitleCategories";

const locale = useLocale();
const { t } = locale;
const store = useStore();
const { titleBlocked, titleUnavailable } = usePlanAccess();
const titles = computed(() => store.getTitles);
const requestOpen = ref(false);

// Categories are display only: locks, the active-titles limit and plan
// checks below stay per title. The header search is global and ignores
// the category filter.
const { settings, setTitleCategorySlug } = useSettings();
const { categories, categoryName, filterKeys, titleInFilter } = useTitleCategories(
  titles,
  locale.current,
  computed(() => settings.value.englishTitleNames === true),
);
const showCategoryFilter = computed(() => categories.value.length > 0);
// The saved slug, while that category still has titles; else All.
const selectedCategory = computed(() => {
  const saved = settings.value.titleCategorySlug ?? CATEGORY_ALL;
  return filterKeys.value.includes(saved) ? saved : CATEGORY_ALL;
});
const selectCategory = (key: string | null | undefined) => {
  void setTitleCategorySlug(key ?? CATEGORY_ALL);
};
const filteredTitles = computed(() =>
  titles.value.filter((title) => titleInFilter(title, selectedCategory.value)),
);
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          {{ t("$vuetify.navigation.titles") }}
        </v-app-bar-title>
        <v-chip
          v-if="store.activeTitleLimit > 0"
          size="small"
          variant="tonal"
          :color="store.activeTitleIds.length >= store.activeTitleLimit ? 'warning' : undefined"
          class="me-2"
        >
          {{ t("$vuetify.titleLimit.counter", localDigits(store.activeTitleIds.length), localDigits(store.activeTitleLimit)) }}
        </v-chip>
      </template>

      <v-card-text class="mb-16">
        <v-chip-group
          v-if="showCategoryFilter"
          :model-value="selectedCategory"
          mandatory
          selected-class="text-primary"
          class="mb-2"
          :aria-label="t('$vuetify.titleCategories.filter')"
          @update:model-value="selectCategory"
        >
          <v-chip :value="CATEGORY_ALL" variant="tonal" size="small">
            {{ t("$vuetify.titleCategories.all") }}
          </v-chip>
          <v-chip
            v-for="category in categories"
            :key="category.id"
            :value="category.slug"
            :prepend-icon="titleCategoryIcon(category.slug)"
            variant="tonal"
            size="small"
          >
            {{ categoryName(category) }}
          </v-chip>
          <v-chip
            v-if="filterKeys.includes(CATEGORY_UNCATEGORIZED)"
            :value="CATEGORY_UNCATEGORIZED"
            variant="tonal"
            size="small"
          >
            {{ t("$vuetify.titleCategories.uncategorized") }}
          </v-chip>
        </v-chip-group>
        <v-data-iterator :items="filteredTitles" :items-per-page="-1">
          <template #default="{ items }">
            <v-row dense>
              <v-col
                v-for="item in items"
                :key="item.raw.id"
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
                  <v-list-item :title="store.titleName(item.raw.name)">
                    <template #prepend>
                      <TitleAvatar
                        :size="40"
                        :image="item.raw.icon_url"
                        class="me-4"
                      />
                    </template>
                    <template #append>
                      <div class="d-flex align-center">
                        <span class="titles-card__fav">
                          <TitleFavoriteButton :title-id="item.raw.id" />
                        </span>
                        <PlanLock v-if="titleBlocked(item.raw.id)" :unavailable="titleUnavailable(item.raw.id)" />
                        <v-tooltip
                          v-else
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
                              :disabled="!store.appReady || store.planBlocked || titleBlocked(item.raw.id)"
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
        <!-- Hidden while its dialog is open. -->
        <v-fab
          appear
          :active="!requestOpen"
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
          :text="t('$vuetify.tickets.requestTitle')"
          @click="requestOpen = true"
        />
      </template>
    </Container>

    <DialogRequestTitle v-model="requestOpen" />
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
