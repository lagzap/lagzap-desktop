<script setup lang="ts">
import { useLocale } from "vuetify";
import { useStore } from "@/stores";
import { useTitleMenu } from "~/composables/useTitleMenu";
import { useFavoriteTitles } from "~/composables/useFavoriteTitles";
import { usePlanAccess } from "~/composables/usePlanAccess";
import TitleAvatar from "~/components/plan/TitleAvatar.vue";

/* Right-click on a title anywhere: turn it on or off, change where it plays
 * from, its settings, pin it, open its page. Location and Settings open the
 * title page and the picker there. */
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
      <!-- The title's own switch. -->
      <v-list-item class="title-menu__switch" :disabled="!canToggle" @click="toggle">
        <template #prepend>
          <TitleAvatar :size="28" :image="title.icon_url" class="me-3" />
        </template>
        <v-list-item-title class="title-menu__name">{{ store.titleName(title.name) }}</v-list-item-title>
        <v-list-item-subtitle>
          {{ t(active ? "$vuetify.title.profile.statusOnShort" : "$vuetify.title.profile.statusOff") }}
        </v-list-item-subtitle>
        <template #append>
          <v-switch
            :model-value="active"
            inset
            hide-details
            color="cyan"
            density="compact"
            class="ms-4 flex-grow-0"
            tabindex="-1"
            :disabled="!canToggle"
            @click.stop.prevent="toggle"
          />
        </template>
      </v-list-item>
      <v-divider class="my-1" />
      <v-list-item prepend-icon="mdi-map-marker-outline" :title="t('$vuetify.title.profile.location')" @click="go('location')" />
      <v-list-item prepend-icon="mdi-cog-outline" :title="t('$vuetify.title.profile.settings')" @click="go('settings')" />
      <v-divider class="my-1" />
      <v-list-item
        :prepend-icon="pinned ? 'mdi-pin-off-outline' : 'mdi-pin-outline'"
        :title="t(pinned ? '$vuetify.title.unpinFavorite' : '$vuetify.title.pinFavorite')"
        :disabled="!pinned && !canPinMore"
        @click="toggleFavorite(title.id); state.open = false"
      />
      <v-list-item prepend-icon="mdi-open-in-app" :title="t('$vuetify.title.openPage')" @click="go()" />
    </v-list>
  </v-menu>
</template>

<style scoped>
.title-menu__switch {
  min-height: 56px !important;
}

.title-menu__name {
  font-size: 0.9375rem;
  font-weight: 500;
}
</style>
