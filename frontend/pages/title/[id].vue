<script setup lang="ts">
import TitleIcon from "~/components/title/TitleIcon.vue";
import Container from "~/components/layout/Container.vue";
import { useStore } from "@/stores";
import { useLocale } from "vuetify";
import ProfileCard from "~/components/title/ProfileCard.vue";
import PlayFromPicker from "~/components/title/PlayFromPicker.vue";
import { ProfileFlag } from "~/constants/profile";
import TitleFavoriteButton from "~/components/title/TitleFavoriteButton.vue";
import ChangelogBadge from "~/components/title/ChangelogBadge.vue";
import { usePlanAccess } from "~/composables/usePlanAccess";
import PlanLock from "~/components/plan/PlanLock.vue";
import ComingSoonMark from "~/components/title/ComingSoonMark.vue";
import AdminLogDialog from "~/components/admin/AdminLogDialog.vue";
import { useLocalStorage } from "@vueuse/core";

const { t } = useLocale();
const store = useStore();
const { titleUnavailable, admin, profileUnavailable } = usePlanAccess();
// Admins: every connection's console lines of this title.
const logOpen = ref(false);
const route = useRoute();
const router = useRouter();
const data = useSanctumUser<DataResponse>();

const title = computed(() =>
  store.titles.find((t) => t.id === (route.params.id as string))
);
/** Titles turned on at least once on this PC: until a title is, a ring
 * pulses around its switch (no popup) to show where to turn it on. */
const turnedOnBefore = useLocalStorage<string[]>("lz-titles-turned-on", []);
watch(
  () => (title.value && store.isTitleActive(title.value.id) ? title.value.id : ""),
  (id) => {
    if (id && !turnedOnBefore.value.includes(id)) turnedOnBefore.value = [...turnedOnBefore.value, id];
  },
  { immediate: true },
);
const nudgeSwitch = computed(
  () => !!title.value && !store.isTitleActive(title.value.id) && !turnedOnBefore.value.includes(title.value.id),
);
const profiles = computed(() =>
  store.profiles
    .filter((p) => p.title_id === title.value.id)
    .sort((a, b) => a.order - b.order)
);

/** Visit time before this page open — used so "new" changelog isn't wiped by visitTitle. */
const changelogSince = ref(0);

/* One "Play from" for the whole game and the game's profile up front;
 * each profile's own location and settings sit in its ⋮ menu. */
/** Profiles that pick a location (locked locations show their lock). */
const locationProfiles = computed(() =>
  profiles.value.filter(
    (p) =>
      p.route_action == "route" &&
      (p.flags & ProfileFlag.ALLOW_REGION_SELECTION) !== 0 &&
      !profileUnavailable(p.id),
  ),
);
/** The picker follows the profiles it covers (a new set, a new picker). */
const locationKey = computed(() => locationProfiles.value.map((p) => p.id).join(","));
/** The game's own profile (its packets optimized); without one, the first
 * plain one (Login connections, not downloads or voice); else the first. */
const featuredId = computed(
  () =>
    (profiles.value.find((p) => (p.flags & ProfileFlag.GAME_PACKET) !== 0) ??
      profiles.value.find((p) => (p.flags & (ProfileFlag.HIGH_TRAFFIC | ProfileFlag.MULTIPATH)) === 0) ??
      profiles.value[0])?.id,
);
/** The featured profile first, the rest in their order. */
const orderedProfiles = computed(() => {
  const list = [...profiles.value];
  const i = list.findIndex((p) => p.id === featuredId.value);
  if (i > 0) list.unshift(...list.splice(i, 1));
  return list;
});
/** A game's downloads (in-game updates): hidden until they carry traffic,
 * then under the title's card with their chart. Only next to a game's
 * profile; other titles keep them under Advanced. */
const busyProfiles = computed(() => {
  const isGame = (p: (typeof profiles.value)[number]) => (p.flags & ProfileFlag.GAME_PACKET) !== 0;
  if (!profiles.value.some(isGame)) return [];
  return orderedProfiles.value.filter((p) => (p.flags & ProfileFlag.HIGH_TRAFFIC) !== 0 && !isGame(p));
});
/** The server picker has the page. */
const picking = ref(false);
const picker = ref<{ closePlaces: () => void; openFor: (profileId: string) => void; editingLabel: string } | null>(null);

/** No profiles yet: nothing to turn on (Coming soon). */
const comingSoon = computed(() => !!title.value && store.titleComingSoon(title.value.id));
/** No plan offers it yet, or coming soon: the title cannot be turned on.
 * The plan locks locations, not titles. */
const cannotActivate = computed(
  () => !!title.value && (titleUnavailable(title.value.id) || comingSoon.value),
);
function recordVisit(titleId: string) {
  // visited_at is Unix seconds (Go's VisitTitle).
  const prev = Number(store.titleStates[titleId]?.visited_at || 0);
  changelogSince.value = Number.isFinite(prev) && prev > 0 ? prev * 1000 : 0;
  void store.visitTitle(titleId);
}

watch(
  () => ({
    id: title.value?.id as string | undefined,
    ready: store.appReady,
  }),
  ({ id, ready }) => {
    if (!id || !ready) {
      return;
    }
    recordVisit(id);
  },
  { immediate: true },
);

</script>

<template>
  <div>
    <Container v-if="title">
      <template #header>
        <!-- The server picker's Back, as on Network Status. -->
        <v-btn
          v-if="picking"
          icon="mdi-arrow-left"
          variant="text"
          size="small"
          class="flip-rtl"
          :aria-label="t('$vuetify.close')"
          @click="picker?.closePlaces()"
        />
        <TitleIcon
          v-if="title"
          :image="title.icon_url"
          :size="40"
          rounded="circle"
          class="ms-3"
          :style="{
            cursor: route.name != 'title-id' ? 'pointer' : 'default',
          }"
          @click="router.push({ name: 'title-id', params: { id: title.id } })"
        />
        <v-app-bar-title
          class="text-subtitle-1"
          @click="router.push({ name: 'title-id', params: { id: title.id } })"
        >
          <!-- The picker open: what it sets, after the game (as Network
               Status / an internet). -->
          <template v-if="picking && picker?.editingLabel">
            <span class="text-medium-emphasis">{{ title ? store.titleName(title.name) : "" }}</span>
            <span class="text-medium-emphasis mx-1">/</span>
            {{ picker.editingLabel }}
          </template>
          <template v-else>{{ title ? store.titleName(title.name) : "" }}</template>
        </v-app-bar-title>

        <v-spacer />
        <ChangelogBadge
          v-if="title"
          dense
          :entries="title.updates"
          :since="changelogSince"
        />
        <!-- The main card's actions (connection quality, rate, report). -->
        <div id="title-main-actions" class="d-flex align-center" />
        <v-btn
          v-if="title && admin"
          v-tooltip:bottom="t('$vuetify.consoleLog.open')"
          icon="mdi-console"
          color="on-surface"
          variant="text"
          size="small"
          :aria-label="t('$vuetify.consoleLog.open')"
          @click="logOpen = true"
        />
        <AdminLogDialog
          v-if="title && admin"
          v-model="logOpen"
          kind="title"
          :id="title.id"
          :name="store.titleName(title.name)"
        />
        <TitleFavoriteButton v-if="title" :title-id="title.id" />
        <ComingSoonMark v-if="comingSoon" :size="18" class="me-2" />
        <PlanLock v-else-if="title && cannotActivate" unavailable />
        <!-- With the main card, the switch sits there, beside its ⋮. -->
        <v-switch
          v-else-if="title && !locationProfiles.length"
          :model-value="store.isTitleActive(title.id)"
          inset
          hide-details
          color="cyan"
          :disabled="!store.appReady"
          class="title-switch flex-grow-0 me-2"
          @click="store.toggleTitleState(title)"
        />
      </template>
      <div v-if="comingSoon" class="title-soon">
        <v-icon icon="mdi-clock-outline" size="48" class="title-soon__icon" />
        <div class="text-h6">{{ t("$vuetify.title.comingSoon") }}</div>
        <div class="text-body-2 text-medium-emphasis">{{ t("$vuetify.title.comingSoonHint") }}</div>
      </div>
      <!-- One card for the title: its places, ping, route and chart.
           Downloads show under it while they run; each profile's own row
           waits under Advanced. -->
      <div v-else-if="title && locationProfiles.length" class="d-flex flex-column ga-3 pa-3">
        <PlayFromPicker
          ref="picker"
          :key="locationKey"
          :profiles="locationProfiles"
          :all-profiles="profiles"
          :changelog-since="changelogSince"
          :single="profiles.length === 1"
          :game-name="store.titleName(title.name)"
          :game-icon="title.icon_url"
          @picking="picking = $event"
        >
          <v-switch
            v-if="!cannotActivate"
            :model-value="store.isTitleActive(title.id)"
            inset
            hide-details
            color="cyan"
            :disabled="!store.appReady"
            class="title-switch--bar flex-grow-0 ms-1"
            :class="{ 'title-switch--nudge': nudgeSwitch }"
            @click="store.toggleTitleState(title)"
          />
        </PlayFromPicker>
        <ProfileCard
          v-for="profile in picking ? [] : busyProfiles"
          :key="`busy-${profile.id}`"
          :profile="profile"
          :changelog-since="changelogSince"
          busy-only
          :game-name="store.titleName(title.name)"
          :game-icon="title.icon_url"
        />
      </div>
      <!-- No location to pick: each profile its own card, as before. -->
      <div v-else-if="title" class="d-flex flex-column ga-3 pa-3">
        <ProfileCard
          v-for="profile in orderedProfiles"
          :key="profile.id"
          :profile="profile"
          :changelog-since="changelogSince"
          :featured="profile.id === featuredId"
          :single="profiles.length === 1"
          :game-name="store.titleName(title.name)"
          :game-icon="title.icon_url"
        />
      </div>
    </Container>
  </div>
</template>

<style scoped>
/* The game's switch beside its Location: bigger, the page's main control. */
.title-switch--bar {
  transform: scale(1.35);
  transform-origin: right center;
  margin-inline-end: 4px;
}

/* Right to left it sits on the left: grow from there, not past the edge. */
.v-locale--is-rtl .title-switch--bar {
  transform-origin: left center;
}

/* Never turned on yet: a ring pulses out of the switch, nothing more. */
.title-switch--nudge :deep(.v-switch__track) {
  position: relative;
  overflow: visible;
}
.title-switch--nudge :deep(.v-switch__track)::before,
.title-switch--nudge :deep(.v-switch__track)::after {
  content: "";
  position: absolute;
  inset: -3px;
  border-radius: 999px;
  border: 2px solid rgb(var(--v-theme-cyan, 0, 188, 212));
  pointer-events: none;
  animation: switch-nudge 2s ease-out infinite;
}
.title-switch--nudge :deep(.v-switch__track)::after {
  animation-delay: 1s;
}
@keyframes switch-nudge {
  from {
    transform: scale(1);
    opacity: 0.8;
  }
  to {
    transform: scale(1.6, 1.9);
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .title-switch--nudge :deep(.v-switch__track)::before,
  .title-switch--nudge :deep(.v-switch__track)::after {
    animation: none;
    opacity: 0.6;
  }
}

/* The game's own switch: the profiles' style, a size up. */
.title-switch {
  transform: scale(1.2);
  transform-origin: top right;
}


.v-theme--light .title-rows {
  background: rgb(var(--v-theme-background));
}

/* No profiles yet: the page says so in the middle of its card. */
.title-soon {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 100%;
  padding: 24px;
  text-align: center;
}

.title-soon__icon {
  margin-bottom: 4px;
  color: rgba(var(--v-theme-on-surface), 0.38);
}
</style>
