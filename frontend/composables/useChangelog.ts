import { computed, type MaybeRefOrGetter, toValue } from "vue";
import type { ChangelogEntry } from "~/bindings/github.com/lagzap/zap/data";

export function normalizeChangelogEntries(
  raw?: (ChangelogEntry | null)[] | null,
): ChangelogEntry[] {
  if (!raw?.length) {
    return [];
  }
  return raw
    .filter((entry): entry is ChangelogEntry => !!entry?.note?.trim())
    .map((entry, index) => ({
      id: entry.id || `changelog-${index}-${entry.created_at || entry.note}`,
      note: entry.note.trim(),
      created_at: entry.created_at || "",
    }))
    .sort((a, b) => {
      const aAt = a.created_at || "";
      const bAt = b.created_at || "";
      return bAt.localeCompare(aAt);
    });
}

/** Parse changelog timestamps; treat unparseable values as 0. */
export function changelogEntryTimeMs(value?: string | null): number {
  if (!value?.trim()) {
    return 0;
  }
  const trimmed = value.trim();
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum > 0) {
    return asNum < 1e12 ? asNum * 1000 : asNum;
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return parsed;
  }
  // Naive "YYYY-MM-DD HH:mm:ss" → local
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!match) {
    return 0;
  }
  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0),
  ).getTime();
}

/**
 * @param sinceMs Last time the user visited this title (ms). `0` / missing =
 * never visited → nothing is treated as "new".
 */
export function useChangelog(
  entries: MaybeRefOrGetter<(ChangelogEntry | null)[] | null | undefined>,
  sinceMs: MaybeRefOrGetter<number | null | undefined> = 0,
) {
  const items = computed(() => normalizeChangelogEntries(toValue(entries)));

  const lastVisitedAt = computed(() => {
    const raw = toValue(sinceMs);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });

  /** Never visited → no "new" highlights. */
  const hasVisited = computed(() => lastVisitedAt.value > 0);

  const unseenItems = computed(() => {
    if (!hasVisited.value) {
      return [];
    }
    const since = lastVisitedAt.value;
    return items.value.filter(
      (entry) => changelogEntryTimeMs(entry.created_at) > since,
    );
  });

  const hasUpdates = computed(() => items.value.length > 0);
  const hasUnseen = computed(() => unseenItems.value.length > 0);
  const unseenCount = computed(() => unseenItems.value.length);

  /** Show whenever there is changelog content; "new" is separate. */
  const visible = computed(() => hasUpdates.value);

  return {
    items,
    unseenItems,
    hasUpdates,
    hasUnseen,
    unseenCount,
    hasVisited,
    visible,
  };
}
