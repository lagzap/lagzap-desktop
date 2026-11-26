<script setup lang="ts">
import { useTitleMenu } from "~/composables/useTitleMenu";
import { useStore } from "@/stores";
import { useLocale } from "vuetify";
import { useFavoriteTitles } from "~/composables/useFavoriteTitles";
import TitleFavoriteButton from "~/components/title/TitleFavoriteButton.vue";
import TitleAvatar from "~/components/plan/TitleAvatar.vue";
import { useFavoritePick } from "~/composables/useFavoritePick";

const { startPicking } = useFavoritePick();

const titleMenu = useTitleMenu();

const { t } = useLocale();
const store = useStore();
const { overviewSource, overviewTitles } = useFavoriteTitles();

const sectionLabel = computed(() => {
  if (overviewSource.value === "favorites") {
    return t("$vuetify.overview.titleGridFavorites");
  }
  if (overviewSource.value === "recent") {
    return t("$vuetify.overview.titleGridRecent");
  }
  return t("$vuetify.overview.titleGridLatest");
});
</script>

<template>
  <div v-if="overviewTitles.length" class="overview-titles px-2 pt-3">
    <div class="text-caption text-medium-emphasis mb-1 px-2">
      {{ sectionLabel }}
    </div>
    <v-slide-group
      class="overview-titles__group"
      show-arrows="hover"
      :mobile-breakpoint="0"
    >
      <!-- First: add another, from Apps & Games. -->
      <v-slide-group-item>
        <button type="button" class="overview-titles__tile overview-titles__add-btn text-decoration-none" @click="startPicking">
          <div class="overview-titles__icon overview-titles__add">
            <v-icon icon="mdi-plus" size="22" />
          </div>
          <span class="overview-titles__name text-caption text-truncate">
            {{ t("$vuetify.overview.addTitle") }}
          </span>
        </button>
      </v-slide-group-item>
      <v-slide-group-item
        v-for="title in overviewTitles"
        :key="title.id"
      >
        <NuxtLink
          :to="{ name: 'title-id', params: { id: title.id } }"
          class="overview-titles__tile text-decoration-none"
          @contextmenu="titleMenu.openAt($event, title.id)"
        >
          <div class="overview-titles__icon">
            <TitleAvatar :size="40" :image="title.icon_url" />
            <span class="overview-titles__fav">
              <TitleFavoriteButton :title-id="title.id" size="x-small" />
            </span>
          </div>
          <span class="overview-titles__name text-caption text-truncate">
            {{ store.titleName(title.name) }}
          </span>
        </NuxtLink>
      </v-slide-group-item>
    </v-slide-group>
  </div>
</template>

<style scoped>
/* The + is a button (it starts picking, no address change): no button look. */
.overview-titles__add-btn {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  cursor: pointer;
}
.overview-titles__tile {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 4.5rem;
  margin-inline: 2px;
  color: inherit;
  padding: 6px 4px;
  border-radius: 10px;
  transition: background-color 0.15s ease;
  user-select: none;
}

.overview-titles__tile:hover {
  background-color: rgba(var(--v-theme-on-surface), 0.06);
}

.overview-titles__icon {
  position: relative;
  width: 40px;
  height: 40px;
}

/* The add tile: a dashed circle with a plus, the size of an icon. */
.overview-titles__add {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1.5px dashed rgba(var(--v-theme-on-surface), 0.35);
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.overview-titles__tile:hover .overview-titles__add {
  border-color: rgba(var(--v-theme-on-surface), 0.6);
  color: rgb(var(--v-theme-on-surface));
}

.overview-titles__fav {
  position: absolute;
  top: -8px;
  inset-inline-end: -10px;
  z-index: 1;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
  background: rgb(var(--v-theme-surface));
  border-radius: 999px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
}

.overview-titles__tile:hover .overview-titles__fav,
.overview-titles__tile:focus-within .overview-titles__fav {
  opacity: 1;
  pointer-events: auto;
}

.overview-titles__name {
  width: 100%;
  text-align: center;
  line-height: 1.2;
}

:deep(.v-slide-group__content) {
  padding-block: 4px;
}
</style>
