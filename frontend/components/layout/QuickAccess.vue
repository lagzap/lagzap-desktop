<script setup lang="ts">
import { useStore } from "@/stores";
import { useLocale } from "vuetify";
import type { Title } from "~/bindings/github.com/lagzap/zap/data";
import { useFavoriteTitles } from "~/composables/useFavoriteTitles";
import TitleFavoriteButton from "~/components/title/TitleFavoriteButton.vue";
import TitleActiveToggle from "~/components/title/TitleActiveToggle.vue";

const { t } = useLocale();
const store = useStore();
const router = useRouter();
const route = useRoute();
const {
  favoriteTitles,
  recentTitlesExcludingFavorites,
  reorderFavoriteTitles,
} = useFavoriteTitles();

const activeTitleId = computed(() => {
  if (route.name !== "title-id") {
    return null;
  }
  const id = route.params.id;
  return id == null ? null : String(id);
});

function isFavoriteActive(title: Title) {
  return activeTitleId.value != null && activeTitleId.value === String(title.id);
}

const favoritesListEl = ref<HTMLElement | null>(null);
const localFavorites = ref<Title[]>([]);
const draggingId = ref<string | null>(null);
const ghost = ref<{
  title: Title;
  x: number;
  y: number;
  width: number;
  height: number;
} | null>(null);

const DRAG_THRESHOLD = 5;
let pointerOrigin = { x: 0, y: 0 };
let grabOffset = { x: 0, y: 0 };
let pendingIndex: number | null = null;
let activeDrag = false;
let didDrag = false;

watch(
  favoriteTitles,
  (titles) => {
    if (!draggingId.value) {
      localFavorites.value = [...titles];
    }
  },
  { immediate: true }
);

function isInteractiveTarget(target: EventTarget | null) {
  return !!(target as HTMLElement | null)?.closest?.(
    "button, .qa-favorite-btn, .v-btn, .v-chip, .v-selection-control, input"
  );
}

function clearWindowListeners() {
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerUp);
}

function onRowPointerDown(index: number, event: PointerEvent) {
  if (event.button !== 0 || isInteractiveTarget(event.target)) {
    return;
  }

  const row = event.currentTarget as HTMLElement;
  const rect = row.getBoundingClientRect();
  pendingIndex = index;
  activeDrag = false;
  didDrag = false;
  pointerOrigin = { x: event.clientX, y: event.clientY };
  grabOffset = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
}

function onPointerMove(event: PointerEvent) {
  if (pendingIndex == null) {
    return;
  }

  const dx = event.clientX - pointerOrigin.x;
  const dy = event.clientY - pointerOrigin.y;

  if (!activeDrag) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD) {
      return;
    }
    const title = localFavorites.value[pendingIndex];
    if (!title || !favoritesListEl.value) {
      return;
    }
    const row = favoritesListEl.value.querySelector<HTMLElement>(
      `[data-fav-id="${title.id}"]`
    );
    const rect = row?.getBoundingClientRect();
    activeDrag = true;
    didDrag = true;
    draggingId.value = title.id;
    ghost.value = {
      title,
      width: rect?.width ?? 220,
      height: rect?.height ?? 40,
      x: event.clientX - grabOffset.x,
      y: event.clientY - grabOffset.y,
    };
    document.body.classList.add("qa-favorites-sorting");
  }

  if (!ghost.value || !draggingId.value) {
    return;
  }

  ghost.value = {
    ...ghost.value,
    x: event.clientX - grabOffset.x,
    y: event.clientY - grabOffset.y,
  };

  if (!favoritesListEl.value) {
    return;
  }

  const rows = [
    ...favoritesListEl.value.querySelectorAll<HTMLElement>("[data-fav-id]"),
  ];
  let targetIndex = localFavorites.value.length - 1;
  for (let i = 0; i < rows.length; i++) {
    const rect = rows[i].getBoundingClientRect();
    if (event.clientY < rect.top + rect.height / 2) {
      targetIndex = i;
      break;
    }
  }

  const fromIndex = localFavorites.value.findIndex(
    (title) => title.id === draggingId.value
  );
  if (fromIndex < 0 || fromIndex === targetIndex) {
    return;
  }

  const next = [...localFavorites.value];
  const [item] = next.splice(fromIndex, 1);
  next.splice(targetIndex, 0, item);
  localFavorites.value = next;
}

async function onPointerUp() {
  clearWindowListeners();
  const wasDragging = activeDrag;
  const orderedIds = localFavorites.value.map((title) => title.id);

  pendingIndex = null;
  activeDrag = false;
  draggingId.value = null;
  ghost.value = null;
  document.body.classList.remove("qa-favorites-sorting");

  if (wasDragging) {
    await reorderFavoriteTitles(orderedIds);
  }

  // Keep didDrag true briefly so the click that follows pointerup is ignored.
  requestAnimationFrame(() => {
    didDrag = false;
  });
}

function onFavoriteClick(title: Title, event: MouseEvent) {
  if (didDrag || activeDrag || isInteractiveTarget(event.target)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  void router.push({ name: "title-id", params: { id: title.id } });
}

onBeforeUnmount(() => {
  clearWindowListeners();
  document.body.classList.remove("qa-favorites-sorting");
});
</script>

<template>
  <v-list nav density="compact" color="tertiary">
    <template v-if="localFavorites.length">
      <v-list-subheader>{{ t("$vuetify.navigation.favorites") }}</v-list-subheader>
      <div ref="favoritesListEl" class="qa-favorites">
        <TransitionGroup
          tag="div"
          name="qa-fav"
        >
          <v-list-item
            v-for="(title, index) in localFavorites"
            :key="title.id"
            :data-fav-id="title.id"
            class="qa-fav-row"
            :class="{ 'qa-fav-row--dragging': draggingId === title.id }"
            :title="store.localized(title.name)"
            :active="isFavoriteActive(title)"
            rounded="xl"
            lines="one"
            @pointerdown="onRowPointerDown(index, $event)"
            @click="onFavoriteClick(title, $event)"
          >
            <template #prepend>
              <v-avatar
                :size="32"
                :image="title.icon_url || undefined"
                class="rounded-lg"
              />
            </template>

            <template #append>
              <div class="d-flex align-center qa-no-drag">
                <v-tooltip
                  v-if="store.hasTitleUnavailableInterfaces(title.id)"
                  :text="`${t('$vuetify.title.profile.unavailableInterfaces')}: ${store.getTitleUnavailableInterfaces(title.id).join(', ')}`"
                >
                  <template #activator="{ props }">
                    <v-icon
                      v-bind="props"
                      color="warning"
                      size="small"
                      class="mr-1"
                    >
                      mdi-alert
                    </v-icon>
                  </template>
                </v-tooltip>

                <span class="qa-favorite-btn">
                  <TitleFavoriteButton :title-id="title.id" size="x-small" />
                </span>

                <TitleActiveToggle :title="title" />
              </div>
            </template>
          </v-list-item>
        </TransitionGroup>
      </div>
    </template>

    <template v-if="recentTitlesExcludingFavorites.length">
      <v-divider
        v-if="localFavorites.length"
        class="my-1"
      />
      <v-list-subheader>{{ t("$vuetify.navigation.recent") }}</v-list-subheader>
      <v-list-item
        v-for="title in recentTitlesExcludingFavorites"
        :key="`recent-${title.id}`"
        :title="store.localized(title.name)"
        :to="{ name: 'title-id', params: { id: title.id } }"
        rounded="xl"
        lines="one"
      >
        <template #prepend>
          <v-avatar
            :size="32"
            :image="title.icon_url || undefined"
            class="rounded-lg"
          />
        </template>

        <template #append>
          <div class="d-flex align-center">
            <v-tooltip
              v-if="store.hasTitleUnavailableInterfaces(title.id)"
              :text="`${t('$vuetify.title.profile.unavailableInterfaces')}: ${store.getTitleUnavailableInterfaces(title.id).join(', ')}`"
            >
              <template #activator="{ props }">
                <v-icon
                  v-bind="props"
                  color="warning"
                  size="small"
                  class="mr-1"
                >
                  mdi-alert
                </v-icon>
              </template>
            </v-tooltip>

            <span class="qa-favorite-btn">
              <TitleFavoriteButton :title-id="title.id" size="x-small" />
            </span>

            <TitleActiveToggle :title="title" />
          </div>
        </template>
      </v-list-item>
    </template>
  </v-list>

  <Teleport to="body">
    <div
      v-if="ghost"
      class="qa-fav-ghost"
      :style="{
        width: `${ghost.width}px`,
        height: `${ghost.height}px`,
        transform: `translate3d(${ghost.x}px, ${ghost.y}px, 0)`,
      }"
    >
      <v-avatar
        :size="32"
        :image="ghost.title.icon_url || undefined"
        class="rounded-lg flex-shrink-0"
      />
      <span class="text-body-2 text-truncate">
        {{ store.localized(ghost.title.name) }}
      </span>
    </div>
  </Teleport>
</template>

<style scoped>
.qa-favorites {
  position: relative;
}

.qa-fav-row {
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.qa-fav-row--dragging {
  opacity: 0.28;
}

.qa-fav-move {
  transition: transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.qa-favorite-btn {
  display: inline-flex;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.v-list-item:hover .qa-favorite-btn,
.v-list-item:focus-within .qa-favorite-btn {
  opacity: 1;
  pointer-events: auto;
}
</style>

<style>
.qa-favorites-sorting {
  cursor: grabbing !important;
}

.qa-favorites-sorting * {
  cursor: grabbing !important;
}

.qa-fav-ghost {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px 0 8px;
  border-radius: 12px;
  pointer-events: none;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  will-change: transform;
}
</style>
