<script setup lang="ts">
import { useLocale } from "vuetify";
import type { Title } from "~/bindings/github.com/lagzap/zap/data";
import { titleCategoriesOf } from "~/composables/useTitleCategories";
import { usePlanAccess } from "~/composables/usePlanAccess";
import TitleIcon from "~/components/title/TitleIcon.vue";
import TitleAvatar from "~/components/plan/TitleAvatar.vue";
import { useFuzzySearch } from "~/composables/useFuzzySearch";
import { DetectedTitles } from "~/bindings/github.com/lagzap/lagzap-desktop/service";

/** Home (until closed with its ✕): "What do you want to play?", a search of its
 * own (the top bar's fuzzy search), and a few games to start with one click (turned on,
 * then their page). People who did not know where to begin start here. */
const { t } = useLocale();
const store = useStore();
const router = useRouter();
const { titleUnavailable } = usePlanAccess();

// Always, until closed with its ✕ (Settings → General shows it again).
const { settings, setHideGetStarted } = useSettings();
const shown = computed(() => store.appReady && !settings.value.hideGetStarted);

const MAX_SUGGESTIONS = 3;
/** "More" opens up to this many, as tiles like the Favorites below. */
const MAX_MORE = 10;
const showMore = ref(false);
/** Titles whose programs this PC used (Go matches the programs LagZap saw
 * on the internet against the profiles' rules), the most used first. Read
 * once when Home opens; it stays on this PC. */
const detectedIds = ref<string[]>([]);
onMounted(async () => {
  try {
    detectedIds.value = keepInTop(((await DetectedTitles()) ?? []).map((item) => item.title_id), discordId.value);
  } catch {
    detectedIds.value = [];
  }
});
/** Discord, found on this PC, is always among the first three (with the
 * launchers, whatever the games ahead of it). */
const discordId = computed(
  () => store.titles.find((title) => Object.values(title.name ?? {}).some((name) => name.trim().toLowerCase() === "discord"))?.id ?? "",
);
function keepInTop(ids: string[], id: string): string[] {
  const at = id ? ids.indexOf(id) : -1;
  if (at < MAX_SUGGESTIONS) return ids;
  const rest = ids.filter((other) => other !== id);
  return [...rest.slice(0, MAX_SUGGESTIONS - 1), id, ...rest.slice(MAX_SUGGESTIONS - 1)];
}
const usable = (title: Title) => !titleUnavailable(title.id) && !store.titleComingSoon(title.id);
/** Found on this PC and not on yet. */
const detected = computed((): Title[] => {
  const found = detectedIds.value
    .map((id) => store.titles.find((title) => title.id === id))
    .filter((title): title is Title => !!title && usable(title) && !store.isTitleActive(title.id));
  // Discord keeps its place among the three after the ones on drop out.
  const ids = keepInTop(found.map((title) => title.id), discordId.value);
  return ids.slice(0, MAX_MORE).map((id) => found.find((title) => title.id === id)!);
});
/** On this PC first; else the games used before (most recent first), else
 * games from the list. */
const allSuggestions = computed((): Title[] => {
  if (detected.value.length) return detected.value;
  const visited = store.getRecentTitles.filter((title) => usable(title) && (store.titleStates[title.id]?.visited_at ?? 0) > 0);
  if (visited.length) return visited.slice(0, MAX_MORE);
  const isGame = (title: Title) => titleCategoriesOf(title).some((category) => category.slug === "game");
  return (store.titles ?? []).filter((title) => usable(title) && isGame(title)).slice(0, MAX_MORE);
});
/** The row's three; "More" shows them all as tiles. */
const suggestions = computed(() => allSuggestions.value.slice(0, MAX_SUGGESTIONS));
const hasMore = computed(() => allSuggestions.value.length > MAX_SUGGESTIONS);
const suggestionLabel = computed(() =>
  detected.value.length
    ? "$vuetify.overview.getStarted.onThisPc"
    : usedBefore.value
      ? "$vuetify.overview.getStarted.recent"
      : "$vuetify.overview.getStarted.popular",
);
const usedBefore = computed(() =>
  suggestions.value.some((title) => (store.titleStates[title.id]?.visited_at ?? 0) > 0),
);

// Search here, the top bar's own way (fuzzy, every language's name): a pick
// starts that game like the buttons below.
const allTitles = computed(() => Object.values(store.titles ?? {}) as Title[]);
const { searchResults, handleSearch } = useFuzzySearch(allTitles, store);
const query = ref("");
function onSearch(value: string | null) {
  query.value = value ?? "";
  handleSearch(query.value);
}
/** Nothing typed: what is on this PC first (as found), then the rest. */
const searchItems = computed(() => {
  if (query.value.trim()) return searchResults.value;
  const order = new Map(detectedIds.value.map((id, i) => [id, i]));
  return [...searchResults.value].sort(
    (a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
});
const picked = ref<string | null>(null);
function onPick(id: string | null) {
  const title = id ? store.titles.find((item) => item.id === id) : null;
  picked.value = null;
  if (title) void start(title);
}

/** One click: on, and to its page (its location and ping are there). */
async function start(title: Title) {
  if (!store.isTitleActive(title.id)) await store.toggleTitleState(title);
  void router.push({ name: "title-id", params: { id: title.id } });
}
</script>

<template>
  <v-expand-transition>
    <section v-if="shown" class="get-started mx-4 mt-3">
      <v-btn
        icon="mdi-close"
        variant="text"
        size="small"
        color="on-surface"
        class="get-started__close"
        :aria-label="t('$vuetify.overview.getStarted.close')"
        v-tooltip:top="t('$vuetify.overview.getStarted.closeHint')"
        @click="setHideGetStarted(true)"
      />
      <div class="get-started__title">
        {{ t("$vuetify.overview.getStarted.title") }}
      </div>
      <div class="get-started__hint">
        {{ t("$vuetify.overview.getStarted.hint") }}
      </div>
      <v-autocomplete
        v-model="picked"
        :items="searchItems"
        item-title="localizedName"
        item-value="id"
        :placeholder="t('$vuetify.overview.getStarted.search')"
        prepend-inner-icon="mdi-magnify"
        variant="outlined"
        density="comfortable"
        rounded="pill"
        hide-details
        single-line
        clearable
        menu-icon=""
        :filter="() => true"
        :custom-filter="() => true"
        class="get-started__search"
        @update:search="onSearch"
        @update:model-value="onPick"
      >
        <template #item="{ props: itemProps, item }">
          <v-list-item v-bind="itemProps" :title="item.raw.localizedName">
            <template #prepend>
              <TitleIcon :image="item.raw.icon_url" :size="32" rounded="circle" class="me-3" />
            </template>
          </v-list-item>
        </template>
      </v-autocomplete>
      <div v-if="suggestions.length" class="get-started__try">
        <span class="get-started__try-label">
          {{ t(suggestionLabel) }}
        </span>
        <v-btn
          v-for="title in suggestions"
          :key="title.id"
          size="small"
          variant="tonal"
          color="on-surface"
          rounded="pill"
          class="text-none"
          @click="start(title)"
        >
          <template #prepend>
            <TitleIcon :image="title.icon_url" :size="18" rounded="circle" />
          </template>
          {{ store.titleName(title.name) }}
        </v-btn>
        <!-- More of them, as tiles below (up to ten). -->
        <v-btn
          v-if="hasMore"
          size="small"
          variant="text"
          color="on-surface"
          rounded="pill"
          class="text-none"
          :append-icon="showMore ? 'mdi-chevron-up' : 'mdi-chevron-down'"
          @click="showMore = !showMore"
        >
          {{ t(showMore ? "$vuetify.overview.getStarted.less" : "$vuetify.overview.getStarted.more") }}
        </v-btn>
      </div>
      <v-expand-transition>
        <div v-if="showMore && hasMore" class="get-started__more">
          <button
            v-for="title in allSuggestions"
            :key="title.id"
            type="button"
            class="get-started__tile"
            @click="start(title)"
          >
            <TitleAvatar :size="40" :image="title.icon_url" />
            <span class="get-started__tile-name text-caption text-truncate">{{ store.titleName(title.name) }}</span>
          </button>
        </div>
      </v-expand-transition>
    </section>
  </v-expand-transition>
</template>

<style scoped>
.get-started {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 22px 16px 18px;
  border: thin solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  background: rgba(var(--v-theme-surface), 0.45);
  text-align: center;
}

.get-started__close {
  position: absolute;
  top: 6px;
  inset-inline-end: 6px;
}

.get-started__title {
  font-size: 1.25rem;
  font-weight: 600;
}

.get-started__hint {
  font-size: 0.875rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* The search, in the card: a pill the width of a phrase. */
.get-started__search {
  width: min(100%, 380px);
  flex: none;
  margin-top: 10px;
  text-align: start;
}

.get-started__try {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

/* "More": the suggestions as tiles, like the Favorites row below. */
.get-started__more {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  width: 100%;
  margin-top: 8px;
}

.get-started__tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 4.5rem;
  padding: 6px 4px;
  border: 0;
  border-radius: 10px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.get-started__tile:hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.get-started__tile-name {
  max-width: 100%;
}

.get-started__try-label {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
</style>
