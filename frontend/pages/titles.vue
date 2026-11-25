<script setup lang="ts">
import { useTitleMenu } from "~/composables/useTitleMenu";
import { useLocale } from "vuetify";
import Container from "~/components/layout/Container.vue";
import TitleFavoriteButton from "~/components/title/TitleFavoriteButton.vue";
import TitleAvatar from "~/components/plan/TitleAvatar.vue";
import PlanLock from "~/components/plan/PlanLock.vue";
import ComingSoonMark from "~/components/title/ComingSoonMark.vue";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { localDigits } from "~/utils/localeFormat";
import { useSettings } from "~/composables/useSettings";
import { useFavoriteTitles } from "~/composables/useFavoriteTitles";
import {
  CATEGORY_ALL,
  CATEGORY_UNCATEGORIZED,
  titleCategoryIcon,
  useTitleCategories,
} from "~/composables/useTitleCategories";

const titleMenu = useTitleMenu();

const locale = useLocale();
const { t } = locale;
const store = useStore();
const { titleUnavailable } = usePlanAccess();
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
// Favorites, in the user's order, among the titles shown here.
const CATEGORY_FAVORITES = "__favorites";
const { favoriteTitles, isFavorite } = useFavoriteTitles();
const favorites = computed(() => {
  const shown = new Set(titles.value.map((title) => title.id));
  return favoriteTitles.value.filter((title) => shown.has(title.id));
});
const showCategoryFilter = computed(() => categories.value.length > 0 || favorites.value.length > 0);
// The saved slug, while that category still has titles; else All.
const selectedCategory = computed(() => {
  const saved = settings.value.titleCategorySlug ?? CATEGORY_ALL;
  if (saved === CATEGORY_FAVORITES) return favorites.value.length ? saved : CATEGORY_ALL;
  return filterKeys.value.includes(saved) ? saved : CATEGORY_ALL;
});
const selectCategory = (key: string | null | undefined) => {
  void setTitleCategorySlug(key ?? CATEGORY_ALL);
};
// A to Z by the name as shown (favorites keep the user's order), so the
// letter rail beside the scrollbar can jump to a letter.
const collator = computed(() => new Intl.Collator(locale.current.value, { sensitivity: "base" }));
const nameOf = (title: (typeof titles.value)[number]) => store.titleName(title.name) ?? "";
const letterOf = (title: (typeof titles.value)[number]) => {
  const first = [...nameOf(title).trim()][0] ?? "";
  return /\p{L}/u.test(first) ? first.toLocaleUpperCase(locale.current.value) : "#";
};
const byName = (list: typeof titles.value) =>
  [...list].sort((a, b) => collator.value.compare(nameOf(a), nameOf(b)));

/** The cards to show: under All, favorites get their own section first;
 * the Favorites filter shows only them. */
const sections = computed(() => {
  const key = selectedCategory.value;
  if (key === CATEGORY_FAVORITES) {
    return [{ key: "list", title: "", items: favorites.value }];
  }
  const list = byName(titles.value.filter((title) => titleInFilter(title, key)));
  if (key !== CATEGORY_ALL || !favorites.value.length) {
    return [{ key: "list", title: "", items: list }];
  }
  return [
    { key: "favorites", title: t("$vuetify.titleCategories.favorites"), items: favorites.value },
    { key: "others", title: t("$vuetify.titleCategories.others"), items: list.filter((title) => !isFavorite(title.id)) },
  ].filter((section) => section.items.length);
});
/** Letter -> the first card with it, in the A to Z section. */
const letterAnchors = computed(() => {
  const sorted = sections.value.at(-1);
  const anchors = new Map<string, string>();
  if (!sorted || selectedCategory.value === CATEGORY_FAVORITES) return anchors;
  for (const title of sorted.items) {
    const letter = letterOf(title);
    if (!anchors.has(letter)) anchors.set(letter, title.id);
  }
  return anchors;
});
// Only worth it for a list that scrolls and spans a few letters.
const showRail = computed(() => letterAnchors.value.size >= 4 && (sections.value.at(-1)?.items.length ?? 0) >= 12);
const railLetter = ref("");
let railDragging = false;

function jumpTo(letter: string) {
  const id = letterAnchors.value.get(letter);
  if (!id) return;
  railLetter.value = letter;
  document.querySelector(`[data-title-card="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
}
function railLetterAt(event: PointerEvent): string {
  const el = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-rail-letter]");
  return el?.dataset.railLetter ?? "";
}
function onRailDown(event: PointerEvent) {
  railDragging = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  jumpTo(railLetterAt(event));
}
function onRailMove(event: PointerEvent) {
  if (!railDragging) return;
  const letter = railLetterAt(event);
  if (letter && letter !== railLetter.value) jumpTo(letter);
}
function onRailUp() {
  railDragging = false;
  railLetter.value = "";
}

// The letter the list is scrolled to: the first card still in view.
const currentLetter = ref("");
const titleById = computed(() => new Map(titles.value.map((title) => [title.id, title])));
let scroller: HTMLElement | null = null;
let scrollFrame = 0;
function updateCurrentLetter() {
  scrollFrame = 0;
  if (!scroller) return;
  const top = scroller.getBoundingClientRect().top + 8;
  for (const el of scroller.querySelectorAll<HTMLElement>("[data-title-card]")) {
    if (el.getBoundingClientRect().bottom <= top) continue;
    const title = titleById.value.get(el.dataset.titleCard ?? "");
    // Favorites above the A to Z list: the rail starts at its first letter.
    currentLetter.value = title && letterAnchors.value.has(letterOf(title)) && !isFavoriteSection(el)
      ? letterOf(title)
      : [...letterAnchors.value.keys()][0] ?? "";
    return;
  }
}
function isFavoriteSection(el: HTMLElement) {
  return selectedCategory.value === CATEGORY_ALL && favorites.value.length > 0 && el.dataset.section === "favorites";
}
function onScroll() {
  if (!scrollFrame) scrollFrame = requestAnimationFrame(updateCurrentLetter);
}
watch(
  showRail,
  async (on) => {
    scroller?.removeEventListener("scroll", onScroll);
    scroller = null;
    if (!on) return;
    await nextTick();
    scroller = document.querySelector<HTMLElement>(".titles-list--rail")?.closest<HTMLElement>(".overflow-y-auto") ?? null;
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    updateCurrentLetter();
  },
  { immediate: true },
);
watch(sections, () => nextTick(updateCurrentLetter));
// Back from a game: the list is where it was left.
const pageRoot = ref<HTMLElement | null>(null);
const pageScroller = () => pageRoot.value?.querySelector<HTMLElement>(".overflow-y-auto") ?? null;
onBeforeRouteLeave(() => {
  savedScrollTop = pageScroller()?.scrollTop ?? 0;
});
onMounted(() => {
  const target = savedScrollTop;
  if (!target) return;
  // The list may still be filling in: try for a moment, until it is tall
  // enough to scroll there.
  const until = performance.now() + 1500;
  const step = () => {
    const el = pageScroller();
    if (el) el.scrollTop = target;
    if ((!el || Math.abs(el.scrollTop - target) > 1) && performance.now() < until) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
});
onBeforeUnmount(() => {
  scroller?.removeEventListener("scroll", onScroll);
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
});
/** Letters near the current one grow a little too, like a dock. */
function railScale(letter: string) {
  const keys = [...letterAnchors.value.keys()];
  const at = keys.indexOf(railLetter.value || currentLetter.value);
  if (at < 0) return 1;
  const d = Math.abs(keys.indexOf(letter) - at);
  return d === 0 ? 1.9 : d === 1 ? 1.35 : d === 2 ? 1.1 : 1;
}

const toggleDisabled = (titleId: string) =>
  !store.appReady || titleUnavailable(titleId) || store.titleComingSoon(titleId);
const onToggle = (title: (typeof titles.value)[number]) => {
  if (!toggleDisabled(title.id)) {
    void store.toggleTitleState(title);
  }
};
</script>

<template>
  <div ref="pageRoot">
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

      <v-card-text class="mb-16" :class="{ 'titles-list--rail': showRail }">
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
            v-if="favorites.length"
            :value="CATEGORY_FAVORITES"
            prepend-icon="mdi-star"
            variant="tonal"
            size="small"
          >
            {{ t("$vuetify.titleCategories.favorites") }}
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
        <template v-for="section in sections" :key="section.key">
        <div v-if="section.title" class="titles-section text-subtitle-2 text-medium-emphasis">
          {{ section.title }}
        </div>
        <v-data-iterator :items="section.items" :items-per-page="-1">
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
                :data-title-card="item.raw.id"
                :data-section="section.key"
                class="titles-col"
              >
                <v-card
                  :to="{ name: 'title-id', params: { id: item.raw.id } }"
                  @contextmenu="titleMenu.openAt($event, item.raw.id)"
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
                        <ComingSoonMark v-if="store.titleComingSoon(item.raw.id)" />
                        <PlanLock v-else-if="titleUnavailable(item.raw.id)" unavailable />
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
                          <!-- The dot turns into a switch on hover, in the
                               dot's own box: the card does not move. -->
                          <template #activator="{ props }">
                            <span
                              v-bind="props"
                              class="titles-card__toggle"
                              :class="{ 'titles-card__toggle--disabled': toggleDisabled(item.raw.id) }"
                              @click.stop.prevent="onToggle(item.raw)"
                            >
                              <v-btn
                                class="titles-card__dot"
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
                                tabindex="-1"
                                :disabled="toggleDisabled(item.raw.id)"
                              />
                              <v-switch
                                class="titles-card__switch"
                                inset
                                density="compact"
                                hide-details
                                readonly
                                color="green"
                                :model-value="store.isTitleActive(item.raw.id)"
                                :disabled="toggleDisabled(item.raw.id)"
                              />
                            </span>
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
        </template>
      </v-card-text>

      <template #outside>
        <!-- A to Z beside the scrollbar: click or drag to jump. -->
        <div
          v-if="showRail"
          class="titles-rail"
          :class="{ 'titles-rail--rtl': locale.isRtl.value }"
          role="navigation"
          @pointerdown.prevent="onRailDown"
          @pointermove="onRailMove"
          @pointerup="onRailUp"
          @pointercancel="onRailUp"
        >
          <span
            v-for="letter in letterAnchors.keys()"
            :key="letter"
            class="titles-rail__letter"
            :class="{ 'titles-rail__letter--on': (railLetter || currentLetter) === letter }"
            :style="{ transform: `scale(${railScale(letter)})` }"
            :data-rail-letter="letter"
          >{{ letter }}</span>
        </div>
        <v-scale-transition>
          <div v-if="railLetter" class="titles-rail__bubble">{{ railLetter }}</div>
        </v-scale-transition>
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
.titles-list--rail {
  padding-inline-end: 40px;
}

.titles-col {
  scroll-margin-top: 8px;
}

/* The letter rail: the full height by the scroll bar, letters spread
   over it; the current letter (and its neighbours, a little) grows. */
.titles-rail {
  position: fixed;
  top: 64px;
  bottom: 96px;
  right: 18px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  width: 26px;
  padding: 10px 0;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  user-select: none;
  touch-action: none;
  cursor: pointer;
  transition: background-color 0.15s;
}

.titles-rail--rtl {
  right: auto;
  left: 18px;
}

.titles-rail:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
}

.titles-rail__letter {
  display: grid;
  place-items: center;
  width: 100%;
  min-height: 14px;
  font-size: 0.66rem;
  font-weight: 600;
  line-height: 1;
  color: rgba(var(--v-theme-on-surface), 0.45);
  transition:
    color 0.15s,
    transform 0.18s cubic-bezier(0.2, 0, 0, 1);
}

.titles-rail__letter:hover {
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.titles-rail__letter--on {
  color: rgb(var(--v-theme-primary));
  font-weight: 800;
}

/* The letter being jumped to, big in the middle while dragging. */
.titles-rail__bubble {
  position: fixed;
  top: 50%;
  left: 50%;
  z-index: 6;
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  margin: -36px 0 0 -36px;
  border-radius: 16px;
  background: rgba(var(--v-theme-surface-bright), 0.92);
  color: rgb(var(--v-theme-primary));
  font-size: 2rem;
  font-weight: 700;
  pointer-events: none;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
}

.titles-section {
  margin: 12px 4px 6px;
}

.titles-section:first-child {
  margin-top: 4px;
}

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

/* The dot's box holds both, sized for the small switch so it stays inside
   the card; the dot keeps its place. */
.titles-card__toggle {
  position: relative;
  width: 36px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.titles-card__toggle--disabled {
  cursor: default;
}

.titles-card__dot,
.titles-card__switch {
  transition:
    transform 0.18s cubic-bezier(0.2, 0, 0, 1),
    opacity 0.18s ease;
}

.titles-card__dot {
  pointer-events: none;
}

/* A little smaller than Vuetify's default dot, as in the sidebar. */
.titles-card__dot :deep(.v-icon) {
  font-size: 20px;
}

.titles-card__switch {
  position: absolute;
  top: 50%;
  left: 50%;
  width: max-content;
  flex: none;
  margin: 0;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -50%) scale(0);
}

.titles-card__switch :deep(.v-selection-control) {
  min-height: 0;
}

.titles-card:hover .titles-card__dot,
.titles-card:focus-within .titles-card__dot {
  opacity: 0;
  transform: scale(0);
}

.titles-card:hover .titles-card__switch,
.titles-card:focus-within .titles-card__switch {
  opacity: 1;
  transform: translate(-50%, -50%) scale(0.6);
}
</style>

<script lang="ts">
/** Where the list was scrolled when the page was left (for the app's
 * lifetime). */
let savedScrollTop = 0;
</script>
