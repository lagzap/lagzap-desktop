<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import { useStore } from "@/stores";
import { useLocale } from "vuetify";
import ProfileCard from "~/components/title/ProfileCard.vue";
import TitleFavoriteButton from "~/components/title/TitleFavoriteButton.vue";

const { t } = useLocale();
const store = useStore();
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

const showInactiveBanner = ref(false);
let bannerDelayTimer: ReturnType<typeof setTimeout> | null = null;

function clearBannerDelay() {
  if (bannerDelayTimer != null) {
    clearTimeout(bannerDelayTimer);
    bannerDelayTimer = null;
  }
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

onMounted(() => {
  nextTick(() => {
    if (!title.value || !store.appReady) {
      return;
    }
    store.visitTitle(title.value.id);
  });
});

onBeforeUnmount(() => {
  clearBannerDelay();
});
</script>

<template>
  <div>
    <Container v-if="title">
      <template #header>
        <v-avatar
          v-if="title?.icon_url"
          density="comfortable"
          :style="{
            cursor: route.name != 'title-id' ? 'pointer' : 'default',
          }"
          @click="router.push({ name: 'title-id', params: { id: title.id } })"
        >
          <v-img :src="title?.icon_url" />
        </v-avatar>
        <v-app-bar-title
          class="text-subtitle-1"
          @click="router.push({ name: 'title-id', params: { id: title.id } })"
        >
          <span>{{ title ? store.localized(title.name) : "" }}</span>
        </v-app-bar-title>

        <v-spacer />
        <TitleFavoriteButton v-if="title" :title-id="title.id" />
        <v-switch
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
          v-if="showInactiveBanner"
          color="primary"
          lines="one"
        >
          <v-banner-text>
            {{ t("$vuetify.title.isNotActive", [store.localized(title.name)]) }}
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

      <div v-if="title" class="d-flex flex-column" style="column-gap: 0.5rem">
        <template v-for="profile in profiles" :key="profile.id">
          <ProfileCard :profile="profile" />
          <v-divider
            v-if="profile.id !== profiles[profiles.length - 1].id"
            class="mx-3"
          />
        </template>
      </div>
    </Container>
  </div>
</template>
