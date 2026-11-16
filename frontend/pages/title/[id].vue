<script setup lang="ts">
import TitleIcon from "~/components/title/TitleIcon.vue";
import Container from "~/components/layout/Container.vue";
import { useStore } from "@/stores";
import { useLocale } from "vuetify";
import ProfileCard from "~/components/title/ProfileCard.vue";
import TitleFavoriteButton from "~/components/title/TitleFavoriteButton.vue";
import ChangelogBadge from "~/components/title/ChangelogBadge.vue";
import { usePlanAccess } from "~/composables/usePlanAccess";
import PlanLock from "~/components/plan/PlanLock.vue";
import ComingSoonMark from "~/components/title/ComingSoonMark.vue";

const { t } = useLocale();
const store = useStore();
const { titleLocked, titleBlocked, titleUnavailable, canUpgrade, openUpgrade } = usePlanAccess();
const route = useRoute();
const router = useRouter();
const data = useSanctumUser<DataResponse>();

const title = computed(() =>
  store.titles.find((t) => t.id === (route.params.id as string))
);
const profiles = computed(() =>
  store.profiles
    .filter((p) => p.title_id === title.value.id)
    .sort((a, b) => a.order - b.order)
);

/** Visit time before this page open — used so "new" changelog isn't wiped by visitTitle. */
const changelogSince = ref(0);

const showInactiveBanner = ref(false);
/** No profiles yet: nothing to turn on (Coming soon). */
const comingSoon = computed(() => !!title.value && store.titleComingSoon(title.value.id));
/** Locked, no active plan or coming soon: the title cannot be turned on. */
const cannotActivate = computed(
  () => !!title.value && (store.planBlocked || titleBlocked(title.value.id) || comingSoon.value),
);
let bannerDelayTimer: ReturnType<typeof setTimeout> | null = null;

function clearBannerDelay() {
  if (bannerDelayTimer != null) {
    clearTimeout(bannerDelayTimer);
    bannerDelayTimer = null;
  }
}

function recordVisit(titleId: string) {
  // visited_at is Unix seconds (Go's VisitTitle).
  const prev = Number(store.titleStates[titleId]?.visited_at || 0);
  changelogSince.value = Number.isFinite(prev) && prev > 0 ? prev * 1000 : 0;
  void store.visitTitle(titleId);
}

watch(
  () => ({
    ready: store.appReady,
    inactive: !!(title.value && !store.isTitleActive(title.value.id)),
  }),
  ({ ready, inactive }) => {
    clearBannerDelay();
    showInactiveBanner.value = false;
    if (!ready || !inactive) {
      return;
    }
    bannerDelayTimer = setTimeout(() => {
      bannerDelayTimer = null;
      showInactiveBanner.value = true;
    }, 500);
  },
  { immediate: true }
);

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

onBeforeUnmount(() => {
  clearBannerDelay();
});
</script>

<template>
  <div>
    <Container v-if="title">
      <template #header>
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
          {{ title ? store.titleName(title.name) : "" }}
        </v-app-bar-title>

        <v-spacer />
        <ChangelogBadge
          v-if="title"
          dense
          :entries="title.updates"
          :since="changelogSince"
        />
        <TitleFavoriteButton v-if="title" :title-id="title.id" />
        <ComingSoonMark v-if="comingSoon" :size="18" class="me-2" />
        <PlanLock v-else-if="title && cannotActivate" :unavailable="titleUnavailable(title.id)" />
        <v-switch
          v-else
          :model-value="store.isTitleActive(title.id)"
          hide-details
          :disabled="!store.appReady"
          :color="store.isTitleActive(title.id) ? 'green' : 'secondary'"
          @click="store.toggleTitleState(title)"
        >
          <v-icon>mdi-pause</v-icon>
        </v-switch>
      </template>
      <v-expand-transition v-if="store.appReady">
        <v-banner
          v-if="showInactiveBanner && !cannotActivate"
          color="primary"
          lines="one"
        >
          <v-banner-text>
            {{ t("$vuetify.title.isNotActive", [store.titleName(title.name)]) }}
          </v-banner-text>

          <template #actions>
            <v-btn
              variant="tonal"
              prepend-icon="mdi-check"
              @click="store.toggleTitleState(title)"
            >
              {{ t("$vuetify.title.action") }}
            </v-btn>
          </template>
        </v-banner>
      </v-expand-transition>

      <v-expand-transition>
        <v-banner
          v-if="title && titleLocked(title.id) && !store.planBlocked && !comingSoon"
          color="warning"
          lines="one"
        >
          <template #prepend>
            <v-avatar color="warning" variant="tonal" icon="mdi-lock-outline" />
          </template>
          <v-banner-text>{{ t("$vuetify.plan.titleLocked") }}</v-banner-text>

          <template v-if="canUpgrade" #actions>
            <v-btn variant="tonal" prepend-icon="mdi-cart-outline" @click="openUpgrade">
              {{ t("$vuetify.plan.unlock") }}
            </v-btn>
          </template>
        </v-banner>
      </v-expand-transition>
      <div v-if="comingSoon" class="title-soon">
        <v-icon icon="mdi-clock-outline" size="48" class="title-soon__icon" />
        <div class="text-h6">{{ t("$vuetify.title.comingSoon") }}</div>
        <div class="text-body-2 text-medium-emphasis">{{ t("$vuetify.title.comingSoonHint") }}</div>
      </div>
      <div v-else-if="title" class="d-flex flex-column" style="column-gap: 0.5rem">
        <template v-for="profile in profiles" :key="profile.id">
          <ProfileCard
            :profile="profile"
            :changelog-since="changelogSince"
          />
          <v-divider
            v-if="profile.id !== profiles[profiles.length - 1].id"
            class="mx-3"
          />
        </template>
      </div>
    </Container>
  </div>
</template>

<style scoped>
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
