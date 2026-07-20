import { computed } from "vue";
import type { Title } from "~/bindings/github.com/lagzap/zap/data";
import { useStore } from "@/stores";
import {
  MAX_FAVORITE_TITLES,
  useSettings,
} from "~/composables/useSettings";
import { displayAlert } from "~/composables/alert";
import { useLocale } from "vuetify";

export const OVERVIEW_TITLE_GRID_LIMIT = 10;

export type OverviewTitleSource = "favorites" | "recent" | "latest";

function parseTitleUpdatedAt(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return asNumber;
  }
  const asDate = Date.parse(value);
  return Number.isFinite(asDate) ? asDate : 0;
}

export function useFavoriteTitles() {
  const store = useStore();
  const { t } = useLocale();
  const { settings, setFavoriteTitleIds } = useSettings();

  const favoriteTitleIds = computed(
    () => settings.value.favoriteTitleIds ?? []
  );

  const favoriteIdSet = computed(() => new Set(favoriteTitleIds.value));

  const favoriteTitles = computed((): Title[] => {
    const byId = new Map(store.titles.map((title) => [title.id, title]));
    return favoriteTitleIds.value
      .map((id) => byId.get(id))
      .filter((title): title is Title => !!title);
  });

  const recentTitlesExcludingFavorites = computed((): Title[] => {
    const pinned = favoriteIdSet.value;
    return store.getRecentTitles.filter((title) => !pinned.has(title.id));
  });

  const isFavorite = (titleId: string) => favoriteIdSet.value.has(titleId);

  const canPinMore = computed(
    () => favoriteTitleIds.value.length < MAX_FAVORITE_TITLES
  );

  const pinTitle = async (titleId: string) => {
    if (!titleId || favoriteIdSet.value.has(titleId)) {
      return false;
    }
    if (!canPinMore.value) {
      displayAlert(t("$vuetify.title.favoriteLimit"), "warning");
      return false;
    }
    await setFavoriteTitleIds([...favoriteTitleIds.value, titleId]);
    return true;
  };

  const unpinTitle = async (titleId: string) => {
    if (!favoriteIdSet.value.has(titleId)) {
      return false;
    }
    await setFavoriteTitleIds(
      favoriteTitleIds.value.filter((id) => id !== titleId)
    );
    return true;
  };

  const toggleFavorite = async (titleId: string) => {
    if (isFavorite(titleId)) {
      return unpinTitle(titleId);
    }
    return pinTitle(titleId);
  };

  const reorderFavoriteTitles = async (orderedIds: string[]) => {
    const pinned = favoriteIdSet.value;
    const next = orderedIds.filter((id) => pinned.has(id));
    for (const id of favoriteTitleIds.value) {
      if (!next.includes(id)) {
        next.push(id);
      }
    }
    await setFavoriteTitleIds(next);
  };

  const moveFavorite = async (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) {
      return;
    }
    const next = [...favoriteTitleIds.value];
    if (fromIndex >= next.length || toIndex >= next.length) {
      return;
    }
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    await setFavoriteTitleIds(next);
  };

  const hasAnyVisit = computed(() =>
    store.titles.some(
      (title) => (store.titleStates[title.id]?.visited_at || 0) > 0
    )
  );

  const overviewSource = computed((): OverviewTitleSource => {
    if (favoriteTitles.value.length > 0) {
      return "favorites";
    }
    if (hasAnyVisit.value) {
      return "recent";
    }
    return "latest";
  });

  const overviewTitles = computed((): Title[] => {
    if (overviewSource.value === "favorites") {
      return favoriteTitles.value.slice(0, OVERVIEW_TITLE_GRID_LIMIT);
    }
    if (overviewSource.value === "recent") {
      return [...store.titles]
        .filter(
          (title) => (store.titleStates[title.id]?.visited_at || 0) > 0
        )
        .sort(
          (a, b) =>
            (store.titleStates[b.id]?.visited_at || 0) -
            (store.titleStates[a.id]?.visited_at || 0)
        )
        .slice(0, OVERVIEW_TITLE_GRID_LIMIT);
    }
    return [...store.titles]
      .sort(
        (a, b) =>
          parseTitleUpdatedAt(b.updated_at) - parseTitleUpdatedAt(a.updated_at)
      )
      .slice(0, OVERVIEW_TITLE_GRID_LIMIT);
  });

  return {
    MAX_FAVORITE_TITLES,
    OVERVIEW_TITLE_GRID_LIMIT,
    favoriteTitleIds,
    favoriteTitles,
    recentTitlesExcludingFavorites,
    overviewSource,
    overviewTitles,
    canPinMore,
    isFavorite,
    pinTitle,
    unpinTitle,
    toggleFavorite,
    reorderFavoriteTitles,
    moveFavorite,
  };
}
