<script setup lang="ts">
import { useTitleMenu } from "~/composables/useTitleMenu";
import TitleIcon from "~/components/title/TitleIcon.vue";
import { useStore } from "@/stores";
import { useLocale } from "vuetify";
import type { Title } from "~/bindings/github.com/lagzap/zap/data";
import { useFavoriteTitles } from "~/composables/useFavoriteTitles";
import TitleActiveToggle from "~/components/title/TitleActiveToggle.vue";
import TitleAvatar from "~/components/plan/TitleAvatar.vue";
import { useSettings } from "~/composables/useSettings";
import { useFavoritePick } from "~/composables/useFavoritePick";
import { useMonitoringStore } from "~/stores/monitoring";

const { t } = useLocale();
const store = useStore();
const router = useRouter();
const titleMenu = useTitleMenu();
const route = useRoute();
const {
  favoriteTitles,
  recentTitlesExcludingFavorites,
  reorderFavoriteTitles,
  canPinMore,
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

/** Titles turned on that are not favorites: Recent's order first, then any
 * other. */
const activeTitles = computed(() => {
  const recent = recentTitlesExcludingFavorites.value.filter((title) => store.isTitleActive(title.id));
  const shown = new Set(recent.map((title) => title.id));
  const pinned = new Set(favoriteTitles.value.map((title) => title.id));
  const others = (store.titles ?? []).filter(
    (title) => store.isTitleActive(title.id) && !shown.has(title.id) && !pinned.has(title.id),
  );
  return [...recent, ...others];
});
/** Recent: the rest, turned off. */
const recentTitles = computed(() =>
  recentTitlesExcludingFavorites.value.filter((title) => !store.isTitleActive(title.id)),
);

/** Favorites as a grid of icons (the default), five a row with their status
 * as badges on the icon, or a list (name, status on the right). Saved with
 * the app's settings, like the favorites themselves. */
const { settings: appSettings, setFavoritesView } = useSettings();
const grid = computed(() => (appSettings.value.favoritesView ?? "grid") === "grid");
function toggleFavoritesView() {
  void setFavoritesView(grid.value ? "list" : "grid");
}

/** Each title's connections now (the Connections page's count). */
const { connections } = useMonitoringStore();
const connectionCounts = computed(() => {
  const counts = new Map<string, number>();
  for (const connection of connections.value ?? []) {
    if (!connection.title_id || connection.profile_id === "") continue;
    counts.set(connection.title_id, (counts.get(connection.title_id) ?? 0) + 1);
  }
  return counts;
});
const countLabel = (n: number) => (n > 99 ? "99+" : String(n));
/** A tile's tooltip: its name, and why it is marked. */
function tileTip(title: Title): string {
  const parts = [store.titleName(title.name)];
  const count = connectionCounts.value.get(title.id) ?? 0;
  if (count > 0) parts.push(t("$vuetify.navigation.favoritesConnections", count));
  if (store.hasTitleUnavailableInterfaces(title.id)) {
    parts.push(`${t("$vuetify.title.profile.unavailableInterfaces")}: ${store.getTitleUnavailableInterfaces(title.id).join(", ")}`);
  }
  return parts.join(" · ");
}
const { startPicking } = useFavoritePick();
// On while LagZap is paused: orange, not green.
const { titlePaused } = useLagzapPaused();
function toggleTitle(title: Title) {
  if (store.appReady) void store.toggleTitleState(title);
}

const showFavoritesHeader = computed(() => localFavorites.value.length > 0);

const showRecentHeader = computed(() => recentTitles.value.length > 0);

/** Add App or Game, first in Active: always, except in the favorites grid
 * while it still has room (the grid has its own + tile). */
const showAddRow = computed(() => !canPinMore.value || !grid.value || !showFavoritesHeader.value);
const showActiveSection = computed(() => showAddRow.value || activeTitles.value.length > 0);
const listSections = computed(() => {
  const sections: { key: "active" | "recent"; label: string; titles: Title[] }[] = [];
  if (showActiveSection.value) {
    sections.push({ key: "active", label: t("$vuetify.navigation.active"), titles: activeTitles.value });
  }
  if (showRecentHeader.value) {
    sections.push({ key: "recent", label: t("$vuetify.navigation.recent"), titles: recentTitles.value });
  }
  return sections.map((section, i) => ({ ...section, divider: i > 0 || showFavoritesHeader.value }));
});

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
  { immediate: true },
);

function isInteractiveTarget(target: EventTarget | null) {
  return !!(target as HTMLElement | null)?.closest?.(
    "button, .tat, .v-btn, .v-chip, .v-selection-control, input",
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
      `[data-fav-id="${title.id}"]`,
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
  if (grid.value) {
    // The grid: the tile nearest the pointer.
    let best = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      const d = Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
      if (d < best) {
        best = d;
        targetIndex = i;
      }
    }
  } else {
    for (let i = 0; i < rows.length; i++) {
      const rect = rows[i].getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        targetIndex = i;
        break;
      }
    }
  }

  const fromIndex = localFavorites.value.findIndex(
    (title) => title.id === draggingId.value,
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
    <template v-if="showFavoritesHeader">
      <div class="qa-favorites__head">
        <v-list-subheader class="flex-grow-1">{{ t("$vuetify.navigation.favorites") }}</v-list-subheader>
        <v-btn
          v-tooltip="t(grid ? '$vuetify.navigation.favoritesAsList' : '$vuetify.navigation.favoritesAsGrid')"
          icon
          size="x-small"
          variant="text"
          density="comfortable"
          color="on-surface"
          class="me-1 qa-view-toggle"
          :aria-label="t(grid ? '$vuetify.navigation.favoritesAsList' : '$vuetify.navigation.favoritesAsGrid')"
          @click="toggleFavoritesView"
        >
          <v-icon size="16">
            {{ grid ? "mdi-view-list-outline" : "mdi-view-grid-outline" }}
          </v-icon>
        </v-btn>
      </div>
      <!-- Grid: icons only, five a row; on/off, connections and a problem
           as badges on the icon; + at the end adds another. -->
      <div
        v-if="grid"
        ref="favoritesListEl"
        class="qa-favorites qa-fav-grid-wrap">
        <TransitionGroup
          tag="div"
          name="qa-fav"
          class="qa-fav-grid">
          <div
            v-for="(title, index) in localFavorites"
            :key="title.id"
            v-tooltip:top="tileTip(title)"
            :data-fav-id="title.id"
            class="qa-fav-tile"
            :class="{
              'qa-fav-tile--active': isFavoriteActive(title),
              'qa-fav-row--dragging': draggingId === title.id,
            }"
            role="link"
            tabindex="0"
            @pointerdown="onRowPointerDown(index, $event)"
            @click="onFavoriteClick(title, $event)"
            @keydown.enter="onFavoriteClick(title, $event as unknown as MouseEvent)"
            @contextmenu="titleMenu.openAt($event, title.id)"
          >
            <TitleAvatar
              :size="28"
              :image="title.icon_url" />
            <!-- A problem with its internets. -->
            <span
              v-if="store.hasTitleUnavailableInterfaces(title.id)"
              class="qa-fav-badge qa-fav-badge--warn">!</span>
            <!-- Its connections now. -->
            <span
              v-else-if="connectionCounts.get(title.id)"
              class="qa-fav-badge qa-fav-badge--count">{{ countLabel(connectionCounts.get(title.id) ?? 0) }}</span>
            <!-- On or off: click switches it. -->
            <button
              type="button"
              class="qa-fav-state tat"
              :class="titlePaused(title.id) ? 'qa-fav-state--paused' : store.isTitleActive(title.id) ? 'qa-fav-state--on' : 'qa-fav-state--off'"
              :aria-label="t(store.isTitleActive(title.id) ? '$vuetify.title.profile.statusOnShort' : '$vuetify.title.profile.statusOff')"
              :disabled="!store.appReady"
              @click.stop="toggleTitle(title)"
            />
          </div>
        </TransitionGroup>
        <button type="button"
          v-if="canPinMore"
          @click="startPicking"
          class="qa-fav-tile qa-fav-tile--add"
          :aria-label="t('$vuetify.navigation.addAppOrGame')"
          v-tooltip:top="t('$vuetify.navigation.addAppOrGame')"
        >
          <v-icon
            icon="mdi-plus"
            size="16" />
        </button>
      </div>
      <div
        v-else
        ref="favoritesListEl"
        class="qa-favorites">
        <TransitionGroup tag="div" name="qa-fav">
          <v-list-item
            v-for="(title, index) in localFavorites"
            :key="title.id"
            :data-fav-id="title.id"
            class="qa-fav-row"
            :class="{ 'qa-fav-row--dragging': draggingId === title.id }"
            :title="store.titleName(title.name)"
            :active="isFavoriteActive(title)"
            rounded="xl"
            lines="one"
            @pointerdown="onRowPointerDown(index, $event)"
            @click="onFavoriteClick(title, $event)"
            @contextmenu="titleMenu.openAt($event, title.id)"
          >
            <template #prepend>
              <TitleAvatar :size="32" :image="title.icon_url" class="me-4" />
            </template>

            <template #append>
              <div class="d-flex align-center qa-no-drag">
                <v-tooltip
                  v-if="store.hasTitleUnavailableInterfaces(title.id)"
                  :text="`${t('$vuetify.title.profile.unavailableInterfaces')}: ${store.getTitleUnavailableInterfaces(title.id).join(', ')}. ${t('$vuetify.title.profile.clearUnavailableInterfacesHint')}`"
                >
                  <template #activator="{ props }">
                    <v-btn
                      v-bind="props"
                      icon
                      variant="text"
                      density="compact"
                      color="warning"
                      size="small"
                      class="mr-1"
                      :aria-label="t('$vuetify.title.profile.clearUnavailableInterfaces')"
                      @click.stop="store.clearTitleUnavailableInterfaces(title.id)"
                    >
                      <v-icon size="small">mdi-alert</v-icon>
                    </v-btn>
                  </template>
                </v-tooltip>

                <TitleActiveToggle :title="title" />
              </div>
            </template>
          </v-list-item>
        </TransitionGroup>
      </div>
    </template>

    <!-- Active (turned on, not favorites), Add App or Game first; then
         Recent (turned off), only when it has any. -->
    <template
      v-for="section in listSections"
      :key="section.key"
    >
      <v-divider
        v-if="section.divider"
        class="my-1"
      />
      <div class="qa-favorites__head">
        <v-list-subheader class="flex-grow-1">{{ section.label }}</v-list-subheader>
      </div>
      <button type="button"
        v-if="section.key === 'active' && showAddRow"
        @click="startPicking"
        class="qa-add-row"
      >
        <v-icon
          icon="mdi-plus"
          size="18"
          class="qa-add-row__icon" />
        <span class="text-body-2">{{ t("$vuetify.navigation.addAppOrGame") }}</span>
      </button>

      <v-list-item
        v-for="title in section.titles"
        :key="`${section.key}-title-${title.id}`"
        :title="store.titleName(title.name)"
        :to="{ name: 'title-id', params: { id: title.id } }"
        rounded="xl"
        @contextmenu="titleMenu.openAt($event, title.id)"
        lines="one"
      >
        <template #prepend>
          <TitleAvatar :size="32" :image="title.icon_url" class="me-4" />
        </template>

        <template #append>
          <div class="d-flex align-center">
            <v-tooltip
              v-if="store.hasTitleUnavailableInterfaces(title.id)"
              :text="`${t('$vuetify.title.profile.unavailableInterfaces')}: ${store.getTitleUnavailableInterfaces(title.id).join(', ')}. ${t('$vuetify.title.profile.clearUnavailableInterfacesHint')}`"
            >
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon
                  variant="text"
                  density="compact"
                  color="warning"
                  size="small"
                  class="mr-1"
                  :aria-label="t('$vuetify.title.profile.clearUnavailableInterfaces')"
                  @click.stop="store.clearTitleUnavailableInterfaces(title.id)"
                >
                  <v-icon size="small">mdi-alert</v-icon>
                </v-btn>
              </template>
            </v-tooltip>

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
      <TitleIcon :size="32" :image="ghost.title.icon_url" class="flex-shrink-0" />
      <span
        v-if="!grid"
        class="text-body-2 text-truncate">
        {{ store.titleName(ghost.title.name) }}
      </span>
    </div>
  </Teleport>
</template>

<style scoped>
.qa-favorites {
  position: relative;
}

/* Grid or list: shown only while the mouse is on the sidebar (or the
   button has keyboard focus). */
.qa-view-toggle {
  opacity: 0;
  transition: opacity 120ms ease;
}

/* An unscoped ancestor, not :global(): Vue turns ":global(.x) .y" into a
   bare ".x" rule. */
.v-navigation-drawer:hover .qa-view-toggle,
.qa-view-toggle:focus-visible {
  opacity: 1;
}
.qa-favorites__head {
  display: flex;
  align-items: center;
}

/* Add, above Recent: a Recent item's size, dashed like the grid's +. */
.qa-add-row {
  width: 100%;
  background: none;
  font: inherit;
  cursor: pointer;
  text-align: start;
  display: flex;
  align-items: center;
  gap: 16px;
  min-height: 40px;
  margin: 4px 0 2px;
  padding: 0 16px 0 14px;
  border: 1.5px dashed rgba(var(--v-theme-on-surface), 0.25);
  border-radius: 24px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  text-decoration: none;
  transition: background-color 0.15s;
}
.qa-add-row:hover,
.qa-add-row:focus-visible {
  background: rgba(var(--v-theme-on-surface), 0.06);
  outline: none;
}
/* Where a Recent item's 32px icon sits. */
.qa-add-row__icon {
  width: 32px;
  flex: none;
}

/* The grid: five icons a row, close together, then +. */
.qa-fav-grid-wrap {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 2px;
  padding: 2px 8px 6px;
}
.qa-fav-grid {
  display: contents;
}
.qa-fav-tile {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 10px;
  cursor: pointer;
  color: inherit;
  text-decoration: none;
  outline: none;
  transition: background-color 0.15s;
}
.qa-fav-tile:hover,
.qa-fav-tile:focus-visible {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.qa-fav-tile--active {
  background: rgba(var(--v-theme-on-surface), 0.1);
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-on-surface), 0.2);
}
.qa-fav-tile--add {
  background: none;
  padding: 0;
  border: 1.5px dashed rgba(var(--v-theme-on-surface), 0.25);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
/* Badges on the icon: connections or a problem (top), on/off (bottom). */
.qa-fav-badge {
  position: absolute;
  top: 0;
  inset-inline-end: 0;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 600;
  line-height: 14px;
  text-align: center;
  pointer-events: none;
}
.qa-fav-badge--count {
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface-variant));
}
.qa-fav-badge--warn {
  background: rgb(var(--v-theme-warning));
  color: rgb(var(--v-theme-on-warning));
}
.qa-fav-state {
  position: absolute;
  bottom: 3px;
  inset-inline-end: 3px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid rgb(var(--v-theme-surface));
  padding: 0;
  cursor: pointer;
}
.qa-fav-state--on {
  background: rgb(var(--v-theme-success));
}
.qa-fav-state--paused {
  background: rgb(var(--v-theme-warning));
}
.qa-fav-state--off {
  background: rgba(var(--v-theme-on-surface), 0.35);
}
/* Hovered, the dot becomes a small switch in the same corner: its knob at
   the end when on, at the start when off. */
.qa-fav-state {
  transition:
    width 0.16s ease,
    height 0.16s ease,
    bottom 0.16s ease,
    inset-inline-end 0.16s ease;
}
.qa-fav-state::after {
  content: "";
  position: absolute;
  top: 50%;
  inset-inline-start: 1px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e8e6d9;
  opacity: 0;
  transform: translateY(-50%);
  transition:
    opacity 0.16s ease,
    inset-inline-start 0.16s ease;
}
.qa-fav-tile:hover .qa-fav-state,
.qa-fav-tile:focus-visible .qa-fav-state {
  width: 22px;
  height: 13px;
  border-radius: 999px;
  bottom: 0;
  inset-inline-end: -2px;
}
.qa-fav-tile:hover .qa-fav-state::after,
.qa-fav-tile:focus-visible .qa-fav-state::after {
  opacity: 1;
}
.qa-fav-tile:hover .qa-fav-state--on::after,
.qa-fav-tile:hover .qa-fav-state--paused::after,
.qa-fav-tile:focus-visible .qa-fav-state--on::after,
.qa-fav-tile:focus-visible .qa-fav-state--paused::after {
  inset-inline-start: 10px;
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
