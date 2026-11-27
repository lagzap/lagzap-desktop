<script setup lang="ts">
import { useLocale } from "vuetify";
import { useStore } from "@/stores";
import { useTitleMenu } from "~/composables/useTitleMenu";
import { useFavoriteTitles } from "~/composables/useFavoriteTitles";
import { usePlanAccess } from "~/composables/usePlanAccess";
import TitleAvatar from "~/components/plan/TitleAvatar.vue";

/* Right-click on a title anywhere: its name opens its page, its switch turns
 * it on or off; then pin it, change where it plays from, its settings.
 * Location and Settings open the title page and the picker there. */
const { t } = useLocale();
const store = useStore();
const router = useRouter();
const { state, request } = useTitleMenu();
const { isFavorite, toggleFavorite, canPinMore } = useFavoriteTitles();
const { titleUnavailable } = usePlanAccess();

const title = computed(() => store.titles.find((x) => x.id === state.titleId) ?? null);
const active = computed(() => !!title.value && store.isTitleActive(title.value.id));
const canToggle = computed(
  () => !!title.value && store.appReady && !titleUnavailable(title.value.id) && !store.titleComingSoon(title.value.id),
);
const pinned = computed(() => !!title.value && isFavorite(title.value.id));
// On while LagZap is paused: orange with a pause knob.
const { titlePaused } = useLagzapPaused();
const pausedOn = computed(() => !!title.value && titlePaused(title.value.id));

function toggle() {
  if (title.value && canToggle.value) void store.toggleTitleState(title.value);
}

function go(what?: "location" | "settings") {
  if (!title.value) return;
  if (what) request(title.value.id, what);
  state.open = false;
  void router.push({ name: "title-id", params: { id: title.value.id } });
}
</script>

<template>
  <v-menu
    v-model="state.open"
    :target="[state.x, state.y]"
    location="bottom start"
    :close-on-content-click="false"
  >
    <v-list v-if="title" density="compact" min-width="240">
      <!-- The title: its name opens its page; its switch turns it on or off. -->
      <v-list-item class="title-menu__head" lines="one" @click="go()">
        <template #prepend>
          <TitleAvatar :size="20" :image="title.icon_url" class="me-3" />
        </template>
        <v-list-item-title class="title-menu__name">{{ store.titleName(title.name) }}</v-list-item-title>
        <template #append>
          <v-switch
            :model-value="active"
            hide-details
            :color="pausedOn ? 'warning' : 'cyan'"
            density="compact"
            class="title-menu__switch ms-3 flex-grow-0"
            tabindex="-1"
            :aria-label="t(active ? '$vuetify.title.profile.statusOnShort' : '$vuetify.title.profile.statusOff')"
            :disabled="!canToggle"
            @click.stop.prevent="toggle"
          >
            <template v-if="pausedOn" #thumb>
              <v-icon icon="mdi-pause" size="12" />
            </template>
          </v-switch>
        </template>
      </v-list-item>
      <v-divider class="my-1" />
      <v-list-item
        :prepend-icon="pinned ? 'mdi-pin-off-outline' : 'mdi-pin-outline'"
        :title="t(pinned ? '$vuetify.title.unpinFavorite' : '$vuetify.title.pinFavorite')"
        :disabled="!pinned && !canPinMore"
        @click="toggleFavorite(title.id); state.open = false"
      />
      <v-list-item prepend-icon="mdi-map-marker-outline" :title="t('$vuetify.title.profile.location')" @click="go('location')" />
      <v-list-item prepend-icon="mdi-cog-outline" :title="t('$vuetify.title.profile.settings')" @click="go('settings')" />
    </v-list>
  </v-menu>
</template>

<style scoped>
/* A small switch: the row stays one compact line. */
.title-menu__switch :deep(.v-selection-control) {
  min-height: 0;
  height: 24px;
}

.title-menu__name {
  font-size: 0.9375rem;
  font-weight: 500;
}
</style>
