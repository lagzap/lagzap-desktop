<script setup lang="ts">
import { marked } from "marked";
import type { ChangelogEntry } from "~/bindings/github.com/lagzap/zap/data";
import { useChangelog } from "~/composables/useChangelog";
import { useLocale } from "vuetify";

marked.setOptions({
  breaks: true,
  gfm: true,
});

const props = withDefaults(
  defineProps<{
    entries?: (ChangelogEntry | null)[] | null;
    /** Previous title visit time (ms). 0 / unset = never visited. */
    since?: number | null;
    /** Compact icon for profile title rows. */
    dense?: boolean;
    /**
     * When true, hide the trigger until `revealed` (or unseen / dialog open).
     */
    hoverReveal?: boolean;
    /** Parent hover/focus state for hoverReveal. */
    revealed?: boolean;
  }>(),
  {
    entries: () => [],
    since: 0,
    dense: false,
    hoverReveal: false,
    revealed: false,
  },
);

const { t } = useLocale();
const dialogOpen = ref(false);

const { items, hasUnseen, visible, unseenItems, unseenCount } = useChangelog(
  () => props.entries,
  () => props.since,
);

const unseenIdSet = computed(
  () => new Set(unseenItems.value.map((entry) => entry.id)),
);

const showTrigger = computed(() => {
  if (!visible.value) {
    return false;
  }
  if (!props.hoverReveal) {
    return true;
  }
  // Always show when there is something new, or while the dialog is open.
  return props.revealed || hasUnseen.value || dialogOpen.value;
});

function formatWhen(value?: string) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function sanitizeHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "");
}

function renderMarkdown(note: string) {
  try {
    const html = marked.parse(note || "", { async: false }) as string;
    return sanitizeHtml(html);
  } catch {
    return sanitizeHtml(note || "");
  }
}

function openDialog(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  dialogOpen.value = true;
}
</script>

<template>
  <template v-if="visible">
    <v-btn
      class="changelog-trigger"
      :class="{
        'changelog-trigger--new': hasUnseen,
        'changelog-trigger--hidden': hoverReveal && !showTrigger,
      }"
      :size="dense ? 'x-small' : 'small'"
      variant="text"
      :color="hasUnseen ? 'info' : undefined"
      icon
      :tabindex="showTrigger ? 0 : -1"
      :aria-hidden="!showTrigger"
      :aria-label="t('$vuetify.title.changelog.title')"
      @click="openDialog"
    >
      <span
        v-if="hasUnseen"
        class="changelog-trigger__count"
        :class="{ 'changelog-trigger__count--dense': dense }"
      >
        {{ unseenCount }}
      </span>
      <v-icon
        v-else
        class="changelog-trigger__history"
        icon="mdi-history"
        :size="dense ? 16 : 18"
      />
    </v-btn>

    <v-dialog
      v-model="dialogOpen"
      max-width="480"
      scrim="black"
      opacity="0.55"
      scrollable
    >
      <v-card rounded="lg">
        <v-card-title class="d-flex align-center justify-space-between py-3">
          <span class="text-subtitle-1">{{
            t("$vuetify.title.changelog.title")
          }}</span>
          <v-btn
            icon="mdi-close"
            size="small"
            variant="text"
            :aria-label="t('$vuetify.close')"
            @click="dialogOpen = false"
          />
        </v-card-title>
        <v-divider />
        <v-card-text class="changelog-dialog__body py-3">
          <div
            v-if="!items.length"
            class="text-body-2 text-medium-emphasis"
          >
            {{ t("$vuetify.title.changelog.empty") }}
          </div>
          <article
            v-for="entry in items"
            :key="entry.id"
            class="changelog-entry"
          >
            <div
              v-if="entry.created_at || unseenIdSet.has(entry.id)"
              class="changelog-entry__meta text-caption text-medium-emphasis mb-2"
            >
              <span
                v-if="unseenIdSet.has(entry.id)"
                class="changelog-entry__new"
              >
                {{ t("$vuetify.title.changelog.newTag") }}
              </span>
              <span v-if="entry.created_at">{{
                formatWhen(entry.created_at)
              }}</span>
            </div>
            <div
              class="changelog-entry__markdown"
              v-html="renderMarkdown(entry.note)"
            />
          </article>
        </v-card-text>
      </v-card>
    </v-dialog>
  </template>
</template>

<style scoped>
.changelog-trigger {
  transition: opacity 0.12s ease;
}

.changelog-trigger--hidden {
  opacity: 0;
  pointer-events: none;
}

.changelog-trigger__history {
  color: rgba(var(--v-theme-on-surface), 0.38);
}

.changelog-trigger__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: rgb(var(--v-theme-info));
  color: rgb(var(--v-theme-on-info));
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1;
}

.changelog-trigger__count--dense {
  min-width: 1.05rem;
  height: 1.05rem;
  padding: 0 0.22rem;
  font-size: 0.62rem;
}

.changelog-dialog__body {
  max-height: min(60vh, 420px);
}

.changelog-entry + .changelog-entry {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.changelog-entry__meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.changelog-entry__new {
  color: rgb(var(--v-theme-info));
  font-weight: 600;
}

.changelog-entry__markdown :deep(p) {
  margin: 0 0 0.55rem;
  font-size: 0.9rem;
  line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.changelog-entry__markdown :deep(p:last-child) {
  margin-bottom: 0;
}

.changelog-entry__markdown :deep(ul),
.changelog-entry__markdown :deep(ol) {
  margin: 0 0 0.55rem;
  padding-inline-start: 1.2rem;
}

.changelog-entry__markdown :deep(li) {
  margin: 0.15rem 0;
  font-size: 0.9rem;
  line-height: 1.45;
}

.changelog-entry__markdown :deep(code) {
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  font-size: 0.82em;
}

.changelog-entry__markdown :deep(a) {
  color: rgb(var(--v-theme-info));
}

.changelog-entry__markdown :deep(h1),
.changelog-entry__markdown :deep(h2),
.changelog-entry__markdown :deep(h3) {
  margin: 0 0 0.45rem;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.35;
}
</style>
