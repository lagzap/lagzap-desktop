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
import { displayAlert } from "~/composables/alert";
import { useFavoritePick } from "~/composables/useFavoritePick";
import { useFuzzySearch } from "~/composables/useFuzzySearch";
import { useElementSize } from "@vueuse/core";
import { DetectedTitles } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
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
// On while LagZap is paused: orange with a pause, not green.
const { titlePaused } = useLagzapPaused();
const { titleUnavailable } = usePlanAccess();
const titles = computed(() => store.getTitles);
const requestOpen = ref(false);

// Categories are display only: locks, the active-titles limit and plan
// checks below stay per title. The header search is global and ignores
// the category filter.
const { settings, setTitleCategorySlug } = useSettings();
const { categories, categoryName, filterKeys, titleInFilter } = useTitleCategories(titles, locale.current);
// Favorites, in the user's order, among the titles shown here.
const CATEGORY_FAVORITES = "__favorites";
const { favoriteTitles, isFavorite, toggleFavorite, canPinMore } = useFavoriteTitles();

// Opened from a Favorites or Recent + (useFavoritePick): the next app or
// game clicked is added instead of opened, then the page is as before.
const { picking: pickingFavorite, pickMode, startPicking, stopPicking } = useFavoritePick();
// The page shows at once; its cards a frame later (placeholders meanwhile).
const contentReady = useDeferredRender();
/** The Favorites section's + card: pick mode, then down to the other apps
 * (under All, where they are) to click one. */
function addFavorite() {
  startPicking();
  if (selectedCategory.value !== CATEGORY_ALL) selectCategory(CATEGORY_ALL);
  void nextTick(() => {
    document.querySelector('[data-section-head]:not([data-section-head="favorites"])')?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
onBeforeUnmount(stopPicking);
/** The pick: added to Favorites and turned on. Favorites full: turned on
 * only, at the top of Recent (on, and just visited). */
async function pickFavorite(id: string, name: string) {
  const title = store.titles.find((item) => item.id === id);
  // From an Active +: only turned on.
  if (pickMode.value === "active") {
    if (title && !store.isTitleActive(id)) await store.toggleTitleState(title);
    await store.visitTitle(id);
    displayAlert(t("$vuetify.title.turnedOnActive", name), "success", 5000);
    stopPicking();
    showPicked(id, false);
    return;
  }
  let pinned = isFavorite(id);
  if (!pinned && canPinMore.value) {
    await toggleFavorite(id);
    pinned = true;
  }
  if (title && !store.isTitleActive(id)) await store.toggleTitleState(title);
  if (!pinned) await store.visitTitle(id);
  displayAlert(
    t(pinned ? "$vuetify.title.addedFavoriteOn" : "$vuetify.title.favoritesFullTurnedOn", name),
    pinned ? "success" : "info",
    5000,
  );
  stopPicking();
  showPicked(id, pinned);
}
/** After a pick: its card (in Favorites when added there) scrolled to the
 * middle and lit up for a moment. */
const pickedId = ref<string | null>(null);
let pickedTimer: ReturnType<typeof setTimeout> | undefined;
function showPicked(id: string, pinned: boolean) {
  void nextTick(() => {
    const section = pinned ? '[data-section="favorites"]' : "";
    const card = document.querySelector(`[data-title-card="${CSS.escape(id)}"]${section}`)
      ?? document.querySelector(`[data-title-card="${CSS.escape(id)}"]`);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    pickedId.value = id;
    clearTimeout(pickedTimer);
    pickedTimer = setTimeout(() => (pickedId.value = null), 1800);
  });
}
onBeforeUnmount(() => clearTimeout(pickedTimer));
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
// Search on the page: the top bar's fuzzy match (every language's name and
// the alias), best first, inside the chosen category.
const pageQuery = ref("");
const { searchResults: pageResults, handleSearch: searchPage } = useFuzzySearch(titles, store);
watch(pageQuery, (value) => searchPage((value ?? "").trim()));
const searching = computed(() => (pageQuery.value ?? "").trim().length > 0);
const sections = computed(() => {
  const key = selectedCategory.value;
  if (searching.value) {
    const byId = new Map(titles.value.map((title) => [title.id, title]));
    const found = pageResults.value
      .map((result) => byId.get(result.id))
      .filter((title): title is (typeof titles.value)[number] => !!title)
      .filter((title) => (key === CATEGORY_FAVORITES ? isFavorite(title.id) : titleInFilter(title, key)));
    return [{ key: "list", title: "", items: found }];
  }
  if (key === CATEGORY_FAVORITES) {
    return [{ key: "list", title: "", items: favorites.value }];
  }
  const inFilter = titles.value.filter((title) => titleInFilter(title, key));
  const placed = new Set<string>();
  const take = (list: typeof titles.value) => {
    const out = list.filter((title) => !placed.has(title.id));
    out.forEach((title) => placed.add(title.id));
    return out;
  };
  const out: { key: string; title: string; items: typeof titles.value }[] = [];
  // Favorites (All only), then one group per category under All (one list
  // in a category); in each, what is on this PC first, then the rest, A to Z.
  if (key === CATEGORY_ALL) {
    out.push({ key: "favorites", title: t("$vuetify.titleCategories.favorites"), items: take(favorites.value) });
    for (const category of categories.value) {
      const items = take(onPcFirst(inFilter.filter((title) => titleCategoriesOf(title)[0]?.slug === category.slug)));
      out.push({ key: `cat-${category.slug}`, title: categoryName(category), items });
    }
    out.push({ key: "others", title: t("$vuetify.titleCategories.others"), items: take(onPcFirst(inFilter)) });
  } else {
    out.push({ key: "list", title: "", items: take(onPcFirst(inFilter)) });
  }
  return out.filter((section) => section.items.length);
});
// The list is at most two cards wide (LIST_MAX_WIDTH, in CSS). With room for
// two columns, Games take the left one and every other group stacks in the
// right; Favorites stay across the top, two a row. Narrower, or searching, or
// in one category: today's layout, the groups one under another.
const listEl = ref<HTMLElement | null>(null);
const { width: listWidth } = useElementSize(listEl);
const TWO_COLUMNS_FROM = 720;
const twoColumns = computed(
  () => listWidth.value >= TWO_COLUMNS_FROM && !searching.value && selectedCategory.value === CATEGORY_ALL,
);
type Column = { key: string; sections: typeof sections.value; cols: number | null };
const columns = computed((): Column[] => {
  if (!twoColumns.value) return [{ key: "all", sections: sections.value, cols: null }];
  const top = sections.value.filter((section) => section.key === "favorites");
  const left = sections.value.filter((section) => section.key === "cat-game");
  const right = sections.value.filter((section) => section.key !== "favorites" && section.key !== "cat-game");
  const list: Column[] = [
    { key: "top", sections: top, cols: 6 },
    { key: "left", sections: left, cols: 12 },
    { key: "right", sections: right, cols: 12 },
  ];
  return list.filter((column) => column.sections.length);
});

/** What is on this PC (A to Z), then the rest (A to Z). */
function onPcFirst(list: typeof titles.value) {
  const onPc = new Set(detectedIds.value);
  const sorted = byName(list);
  return [...sorted.filter((title) => onPc.has(title.id)), ...sorted.filter((title) => !onPc.has(title.id))];
}
/** Titles whose programs this PC used (Go matches them against the
 * profiles' rules and the titles' names): shown first. Read on open. */
const detectedIds = ref<string[]>([]);
onMounted(async () => {
  try {
    detectedIds.value = ((await DetectedTitles()) ?? []).map((item) => item.title_id);
  } catch {
    detectedIds.value = [];
  }
});
/** Letter -> the first card with it (by name), outside Favorites. */
const letterAnchors = computed(() => {
  const anchors = new Map<string, string>();
  if (selectedCategory.value === CATEGORY_FAVORITES || searching.value) return anchors;
  const lists = sections.value.filter((section) => section.key !== "favorites");
  const all = lists.flatMap((section) => section.items).sort((a, b) => collator.value.compare(nameOf(a), nameOf(b)));
  for (const title of all) {
    const letter = letterOf(title);
    if (!anchors.has(letter)) anchors.set(letter, title.id);
  }
  return anchors;
});
/** The rail's own mark for Favorites, above A. */
const RAIL_FAVORITES = "★";
const hasFavoritesSection = computed(() => sections.value.some((section) => section.key === "favorites"));
/** The rail: the star (Favorites, when shown above the list), then A to Z. */
const railKeys = computed(() => [...(hasFavoritesSection.value ? [RAIL_FAVORITES] : []), ...letterAnchors.value.keys()]);
// Only worth it for a list that scrolls and spans a few letters.
const showRail = computed(() => letterAnchors.value.size >= 4 && (sections.value.at(-1)?.items.length ?? 0) >= 12);
const railLetter = ref("");
let railDragging = false;

function jumpTo(letter: string) {
  if (letter === RAIL_FAVORITES) {
    railLetter.value = letter;
    document.querySelector('[data-section-head="favorites"]')?.scrollIntoView({ block: "start" });
    return;
  }
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
    // In Favorites (above the A to Z list): the star.
    currentLetter.value = isFavoriteSection(el) && hasFavoritesSection.value
      ? RAIL_FAVORITES
      : title && letterAnchors.value.has(letterOf(title))
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
  const keys = railKeys.value;
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

      <v-card-text class="mb-16 titles-list" :class="{ 'titles-list--rail': showRail }">
        <!-- From a Favorites +: the next one clicked is added. Stays at the
             top while the list scrolls. -->
        <div
          v-if="pickingFavorite"
          class="titles-pick">
        <v-alert
          variant="tonal"
          density="compact"
          rounded="lg"
          icon="mdi-star-plus-outline"
        >
          <div class="d-flex align-center flex-wrap ga-2">
            <span class="flex-grow-1">{{ t(pickMode === "active" ? "$vuetify.title.pickActive" : canPinMore ? "$vuetify.title.pickFavorite" : "$vuetify.title.pickRecent") }}</span>
            <v-btn
              size="small"
              variant="text"
              color="on-surface"
              class="text-none"
              @click="stopPicking"
            >
              {{ t("$vuetify.title.pickFavoriteCancel") }}
            </v-btn>
          </div>
        </v-alert>
        </div>
        <!-- Search this page (results best first, in the chosen category). -->
        <v-text-field
          v-model="pageQuery"
          :placeholder="t('$vuetify.overview.getStarted.search')"
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          density="compact"
          rounded="pill"
          hide-details
          clearable
          class="titles-search mb-2"
          @keyup.escape="pageQuery = ''"
        />
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
        <!-- Until the cards render (a frame after the page shows): their
             placeholders. -->
        <v-row v-if="!contentReady" dense>
          <v-col v-for="n in 12" :key="n" cols="12" sm="6" md="6" lg="4" xl="3">
            <v-skeleton-loader type="list-item-avatar" class="titles-skeleton mb-1" />
          </v-col>
        </v-row>
        <div
          v-if="contentReady && searching && !sections[0]?.items.length"
          class="text-body-2 text-medium-emphasis text-center py-8"
        >
          {{ t("$vuetify.titleCategories.noMatch") }}
        </div>
        <div ref="listEl" class="titles-layout" :class="{ 'titles-layout--two': twoColumns }">
        <div
          v-for="column in contentReady ? columns : []"
          :key="column.key"
          class="titles-layout__col"
          :class="`titles-layout__col--${column.key}`"
        >
        <template v-for="section in column.sections" :key="section.key">
        <div v-if="section.title" class="titles-section text-subtitle-2 text-medium-emphasis" :data-section-head="section.key">
          {{ section.title }}
        </div>
        <v-data-iterator :items="section.items" :items-per-page="-1">
          <template #default="{ items }">
            <v-row dense>
              <v-col
                v-for="item in items"
                :key="item.raw.id"
                cols="12"
                :sm="column.cols ?? 6"
                :md="column.cols ?? 6"
                :lg="column.cols ?? 4"
                :xl="column.cols ?? 3"
                :data-title-card="item.raw.id"
                :data-section="section.key"
                class="titles-col"
              >
                <v-card
                  :to="pickingFavorite ? undefined : { name: 'title-id', params: { id: item.raw.id } }"
                  @click="pickingFavorite && pickFavorite(item.raw.id, store.titleName(item.raw.name))"
                  @contextmenu="titleMenu.openAt($event, item.raw.id)"
                  class="py-1 mb-1 titles-card"
                  :class="{ 'titles-card--picked': pickedId === item.raw.id }"
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
                                  titlePaused(item.raw.id)
                                    ? 'warning'
                                    : store.isTitleActive(item.raw.id)
                                      ? 'green'
                                      : 'secondary'
                                "
                                :icon="
                                  titlePaused(item.raw.id)
                                    ? 'mdi-pause'
                                    : store.ndisRunning
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
                                :color="titlePaused(item.raw.id) ? 'warning' : 'green'"
                                :model-value="store.isTitleActive(item.raw.id)"
                                :disabled="toggleDisabled(item.raw.id)"
                              >
                                <template v-if="titlePaused(item.raw.id)" #thumb>
                                  <v-icon icon="mdi-pause" size="14" />
                                </template>
                              </v-switch>
                            </span>
                          </template>
                        </v-tooltip>
                      </div>
                    </template>
                  </v-list-item>
                </v-card>
              </v-col>
              <!-- Favorites with room left: one more card to add one. -->
              <v-col
                v-if="section.key === 'favorites' && canPinMore && !pickingFavorite"
                cols="12"
                :sm="column.cols ?? 6"
                :md="column.cols ?? 6"
                :lg="column.cols ?? 4"
                :xl="column.cols ?? 3"
                class="titles-col"
              >
                <button type="button" class="titles-card titles-card--add mb-1" @click="addFavorite">
                  <span class="titles-card__add-icon"><v-icon icon="mdi-plus" size="20" /></span>
                  <span class="text-body-1">{{ t("$vuetify.title.pinFavorite") }}</span>
                </button>
              </v-col>
            </v-row>
          </template>
        </v-data-iterator>
        </template>
        </div>
        </div>
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
            v-for="letter in railKeys"
            :key="letter"
            class="titles-rail__letter"
            :class="{ 'titles-rail__letter--on': (railLetter || currentLetter) === letter }"
            :style="{ transform: `scale(${railScale(letter)})` }"
            :data-rail-letter="letter"
            :aria-label="letter === RAIL_FAVORITES ? t('$vuetify.titleCategories.favorites') : undefined"
          >
            <v-icon v-if="letter === RAIL_FAVORITES" icon="mdi-star" size="11" />
            <template v-else>{{ letter }}</template>
          </span>
        </div>
        <v-scale-transition>
          <div v-if="railLetter" class="titles-rail__bubble">
            <v-icon v-if="railLetter === RAIL_FAVORITES" icon="mdi-star" size="32" />
            <template v-else>{{ railLetter }}</template>
          </div>
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
/* The pick's banner: fixed at the top of the list as it scrolls, on the
   page's own background so rows do not show through. */
.titles-pick {
  position: sticky;
  top: 0;
  z-index: 3;
  padding-bottom: 12px;
  background: rgb(var(--v-theme-surface));
}
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
  color: rgb(var(--v-theme-on-surface));
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
  color: rgb(var(--v-theme-on-surface));
  font-size: 2rem;
  font-weight: 700;
  pointer-events: none;
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
}

.titles-section {
  margin: 12px 4px 6px;
  /* Scrolled to from a Favorites +: clear of the pick banner on top. */
  scroll-margin-top: 72px;
}

/* Just picked: a ring that fades out. */
.titles-card--picked {
  animation: titles-picked 1.8s ease-out;
}

@keyframes titles-picked {
  0%,
  40% {
    box-shadow: 0 0 0 2px rgba(var(--v-theme-on-surface), 0.6);
    background: rgba(var(--v-theme-on-surface), 0.08);
  }
  100% {
    box-shadow: 0 0 0 2px rgba(var(--v-theme-on-surface), 0);
  }
}

.titles-section:first-child {
  margin-top: 4px;
}

/* At most two cards wide (LIST_MAX_WIDTH), however wide the window. */
.titles-list {
  max-width: 920px;
  margin-inline: auto;
}

/* Two columns: Favorites across the top, Games on the left, the other
   groups stacked on the right. */
.titles-layout--two {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  column-gap: 8px;
  align-items: start;
}

.titles-layout--two .titles-layout__col--top {
  grid-column: 1 / -1;
}

.titles-layout--two .titles-layout__col--left {
  grid-column: 1;
}

.titles-layout--two .titles-layout__col--right {
  grid-column: 2;
}

/* The page's search: a pill the width of a phrase. */
.titles-search {
  max-width: 380px;
}

/* A card's placeholder: a card's size and corners. */
.titles-skeleton {
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

/* The + card: a card's size (56px tall, icon box and text where a card's
   are), dashed like the sidebar's add. */
.titles-card--add {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  height: 56px;
  padding: 0 16px;
  border: 1.5px dashed rgba(var(--v-theme-on-surface), 0.25);
  border-radius: 8px;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

/* Where a card's 40px icon sits, so the words line up with the names. */
.titles-card__add-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  flex: none;
}

.titles-card--add:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgb(var(--v-theme-on-surface));
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
