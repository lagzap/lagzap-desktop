<script setup lang="ts">
import { useLocale } from "vuetify";
import { useConnectionRejected } from "~/composables/useConnectionRejected";

/** A profile's connection was rejected (see useConnectionRejected): a banner
 * at the top of the page, under the plan banner, instead of a popup. */
const { t } = useLocale();
const store = useStore();
const router = useRouter();
const { rejection, dismiss } = useConnectionRejected();
const route = useRoute();
/** On the game's own page the page says it (PlayFromPicker), not this. */
const onItsPage = computed(() => route.name === "title-id" && String(route.params.id) === rejection.value?.title_id);

const turningOff = ref(false);

const gameName = computed(() => {
  const game = store.titles.find((item) => item.id === rejection.value?.title_id);
  return game ? store.titleName(game.name) : "";
});

const title = computed(() =>
  gameName.value
    ? t("$vuetify.connectionRejected.titleGame", [gameName.value])
    : t("$vuetify.connectionRejected.title"),
);

const reason = computed(() => {
  const r = rejection.value;
  if (!r) return "";
  if (r.code === "no_route") {
    return r.selection
      ? t("$vuetify.connectionRejected.noRouteIn", [r.selection])
      : t("$vuetify.connectionRejected.noRoute");
  }
  return r.selection
    ? t("$vuetify.connectionRejected.noServerIn", [r.selection])
    : t("$vuetify.connectionRejected.noServer");
});

async function turnOff() {
  const id = rejection.value?.profile_id;
  if (!id) return;
  turningOff.value = true;
  try {
    if (store.isProfileActive(id)) await store.deactivateProfile(id);
    dismiss();
  } finally {
    turningOff.value = false;
  }
}

function changeLocation() {
  const id = rejection.value?.title_id;
  dismiss();
  if (id) void router.push({ name: "title-id", params: { id } });
}
</script>

<template>
  <v-expand-transition>
    <v-banner v-if="rejection && !onItsPage" color="error" class="rejected-banner">
      <template #prepend>
        <v-avatar color="error" variant="tonal" icon="mdi-shield-alert-outline" />
      </template>
      <v-banner-text>
        <div class="font-weight-medium">{{ title }}</div>
        <div class="text-body-2">{{ reason }}</div>
        <div class="text-caption text-medium-emphasis">
          {{ t("$vuetify.connectionRejected.hint") }}
        </div>
      </v-banner-text>
      <template #actions>
        <v-btn variant="tonal" color="on-surface" :loading="turningOff" @click="turnOff">
          {{ t("$vuetify.connectionRejected.turnOff") }}
        </v-btn>
        <v-btn variant="tonal" color="on-surface" @click="changeLocation">
          {{ t("$vuetify.connectionRejected.changeLocation") }}
        </v-btn>
        <v-btn
          icon="mdi-close"
          variant="text"
          color="on-surface"
          size="small"
          class="ms-1"
          :aria-label="t('$vuetify.connectionRejected.close')"
          @click="dismiss"
        />
      </template>
    </v-banner>
  </v-expand-transition>
</template>

<style scoped>
.rejected-banner :deep(.v-banner-text) {
  padding-inline-end: 8px;
}
</style>
