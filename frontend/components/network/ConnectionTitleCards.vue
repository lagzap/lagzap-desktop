<script setup lang="ts">
import { useLocale } from "vuetify";
import type { Title } from "~/bindings/github.com/lagzap/zap/data";
import TitleAvatar from "~/components/plan/TitleAvatar.vue";
import TitleActiveToggle from "~/components/title/TitleActiveToggle.vue";
import { useTitleMenu } from "~/composables/useTitleMenu";
import { useFavoriteTitles } from "~/composables/useFavoriteTitles";
import { useFavoritePick } from "~/composables/useFavoritePick";

/** Above the connections table: Favorites (pinned), then Active (the other
 * apps and games that are on) with + to turn one more on. A card opens
 * or closes its connections in the table; its dot (a switch on hover) turns
 * it on or off. */
const props = defineProps<{
  /** Connections per title id, as the table lists them. */
  counts: Map<string, number>;
  /** Whether the table shows a title's connections. */
  isOpen: (titleId: string) => boolean;
}>();
const emit = defineEmits<{ toggle: [titleId: string] }>();

const { t } = useLocale();
const store = useStore();
const router = useRouter();
const { favoriteTitles } = useFavoriteTitles();
const { startPicking } = useFavoritePick();
const titleMenu = useTitleMenu();

/** Favorites (pinned), then Active: the other apps and games that are on or
 * have connections, with + to turn one more on. */
const sections = computed(() => {
  const pinned = new Set(favoriteTitles.value.map((title) => title.id));
  const active = (store.titles ?? []).filter(
    (title) => !pinned.has(title.id) && (store.isTitleActive(title.id) || (props.counts.get(title.id) ?? 0) > 0),
  );
  const list: { key: "favorites" | "active"; label: string; titles: Title[] }[] = [];
  if (favoriteTitles.value.length) {
    list.push({ key: "favorites", label: t("$vuetify.navigation.favorites"), titles: favoriteTitles.value });
  }
  list.push({ key: "active", label: t("$vuetify.navigation.active"), titles: active });
  return list;
});

/** Four cards a section at most, so the page stays about connections: the
 * busiest first (connections, then on), the rest behind a "+N" card that
 * opens the whole section. Active's + takes one of the four. */
const MAX_CARDS = 4;
const expanded = ref(new Set<string>());
function shown(section: { key: string; titles: Title[] }) {
  const room = MAX_CARDS - (section.key === "active" ? 1 : 0);
  const open = expanded.value.has(section.key);
  if (section.titles.length <= room) return { titles: section.titles, hidden: [] as Title[], open: false };
  if (open) return { titles: section.titles, hidden: [] as Title[], open: true };
  const rank = (title: Title) => ((props.counts.get(title.id) ?? 0) > 0 ? 2 : store.isTitleActive(title.id) ? 1 : 0);
  // Stable: the user's own order within the same rank.
  const sorted = section.titles.map((title, i) => ({ title, i })).sort((a, b) => rank(b.title) - rank(a.title) || a.i - b.i);
  const visible = sorted.slice(0, room - 1).map((x) => x.title);
  const keep = new Set(visible.map((title) => title.id));
  return {
    titles: section.titles.filter((title) => keep.has(title.id)),
    hidden: section.titles.filter((title) => !keep.has(title.id)),
    open: false,
  };
}
const views = computed(() => sections.value.map((section) => ({ ...section, view: shown(section) })));
function setExpanded(key: string, open: boolean) {
  const next = new Set(expanded.value);
  if (open) next.add(key);
  else next.delete(key);
  expanded.value = next;
}

/** With connections, the card opens or closes them; without, its page. */
function open(title: Title, event?: Event) {
  // Its switch (or chip) and pin are their own; never the card's click.
  if ((event?.target as HTMLElement | null)?.closest?.(".tat, .ctc__pin")) return;
  if ((props.counts.get(title.id) ?? 0) > 0) emit("toggle", title.id);
  else void router.push({ name: "title-id", params: { id: title.id } });
}

</script>

<template>
  <!-- The same cards as Apps & Games: icon, name, and the dot that turns
       into the switch on hover (TitleActiveToggle). Off: half grey. -->
  <template v-for="section in views" :key="section.key">
    <div class="ctc__head text-subtitle-2 text-medium-emphasis">{{ section.label }}</div>
    <v-row dense class="ctc">
      <v-col
        v-for="title in section.view.titles"
        :key="title.id"
        cols="12"
        sm="6"
        lg="4"
        xl="3"
      >
        <v-card
          class="py-1 ctc__card"
          :class="{
            'ctc__card--open': isOpen(title.id),
            'ctc__card--off': !store.isTitleActive(title.id),
          }"
          @click="open(title, $event)"
          @contextmenu="titleMenu.openAt($event, title.id)"
        >
          <v-list-item :title="store.titleName(title.name)">
            <template #prepend>
              <TitleAvatar :size="40" :image="title.icon_url" class="me-4" />
            </template>
            <template #append>
              <div class="d-flex align-center">
                <!-- Pinned: one of the Favorites. -->
                <v-icon
                  v-if="section.key === 'favorites'"
                  v-tooltip:top="t('$vuetify.navigation.favorites')"
                  icon="mdi-pin"
                  size="16"
                  class="ctc__pin me-1"
                />
                <TitleActiveToggle :title="title" />
              </div>
            </template>
          </v-list-item>
        </v-card>
      </v-col>
      <!-- More than fit: their icons and "+N", which opens the section. -->
      <v-col v-if="section.view.hidden.length" cols="12" sm="6" lg="4" xl="3">
        <button type="button" class="ctc__add ctc__more" @click="setExpanded(section.key, true)">
          <span class="ctc__stack">
            <TitleAvatar
              v-for="title in section.view.hidden.slice(0, 3)"
              :key="title.id"
              :size="28"
              :image="title.icon_url"
              class="ctc__stack-icon"
            />
          </span>
          <span class="text-body-1">{{ t("$vuetify.connections.showMore", localDigits(section.view.hidden.length)) }}</span>
        </button>
      </v-col>
      <!-- Opened: back to four. -->
      <v-col v-if="section.view.open" cols="12" sm="6" lg="4" xl="3">
        <button type="button" class="ctc__add" @click="setExpanded(section.key, false)">
          <span class="ctc__add-icon"><v-icon icon="mdi-chevron-up" size="20" /></span>
          <span class="text-body-1">{{ t("$vuetify.connections.showLess") }}</span>
        </button>
      </v-col>
      <!-- Active: + picks one more app or game to turn on. -->
      <v-col v-if="section.key === 'active'" cols="12" sm="6" lg="4" xl="3">
        <button type="button" class="ctc__add" @click="startPicking('active')">
          <span class="ctc__add-icon"><v-icon icon="mdi-plus" size="20" /></span>
          <span class="text-body-1">{{ t("$vuetify.navigation.addAppOrGame") }}</span>
        </button>
      </v-col>
    </v-row>
  </template>
</template>

<style scoped>
.ctc {
  margin-bottom: 8px;
}

.ctc__head {
  margin: 4px 4px 6px;
}

.ctc__pin {
  opacity: 0.6;
}

/* Off: the card half grey, its icon too. */
.ctc__card--off {
  filter: grayscale(0.5);
}

.ctc__card--off :deep(.v-list-item__prepend),
.ctc__card--off :deep(.v-list-item-title) {
  opacity: 0.7;
}

/* Its connections shown in the table below. */
.ctc__card--open {
  box-shadow: 0 0 0 1px rgba(var(--v-theme-on-surface), 0.32);
}

/* The + card: a card's size, dashed, its words where a card's name is. */
.ctc__add {
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

.ctc__add:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: rgb(var(--v-theme-on-surface));
}

/* The "+N" card: a solid border, the hidden ones' icons overlapping. */
.ctc__more {
  border-style: solid;
  border-width: 1px;
  border-color: rgba(var(--v-theme-on-surface), 0.12);
}

.ctc__stack {
  display: inline-flex;
  align-items: center;
  flex: none;
  min-width: 40px;
}

.ctc__stack-icon + .ctc__stack-icon {
  margin-inline-start: -8px;
}

.ctc__add-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  flex: none;
}
</style>
