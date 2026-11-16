<script setup lang="ts">
import { useLocale } from "vuetify";
import Container from "~/components/layout/Container.vue";
import AdminInsights from "~/components/admin/AdminInsights.vue";
import { GetProfiles, GetTitles } from "~/bindings/github.com/lagzap/lagzap-desktop/service";

definePageMeta({
  layout: "admin",
  sanctum: {
    excluded: true,
  },
});

/** Any title's or profile's console log and statistics, live: the same view
 * as the admin button on a title or profile in the app. */
const { t } = useLocale();
const store = useStore();

onMounted(async () => {
  try {
    if (!store.titles.length) store.titles = Object.values(await GetTitles());
    if (!store.profiles.length) store.profiles = Object.values(await GetProfiles());
  } catch {
    // service not running yet
  }
});

const titleId = ref<string | null>(null);
/** "" is the whole title. */
const profileId = ref("");
watch(titleId, () => (profileId.value = ""));

const titleItems = computed(() =>
  store.titles
    .map((title) => ({ value: title.id, title: store.titleName(title.name) }))
    .sort((a, b) => a.title.localeCompare(b.title)),
);
const profileItems = computed(() => [
  { value: "", title: t("$vuetify.consoleLog.wholeTitle") },
  ...store.profiles
    .filter((profile) => profile.title_id === titleId.value)
    .sort((a, b) => a.order - b.order)
    .map((profile) => ({ value: profile.id, title: store.localized(profile.name) })),
]);
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">{{ t("$vuetify.consoleLog.page") }}</v-app-bar-title>
      </template>
      <div class="pa-3">
        <div class="d-flex flex-wrap ga-3 mb-3">
          <v-autocomplete
            v-model="titleId"
            :items="titleItems"
            :label="t('$vuetify.consoleLog.pickTitle')"
            variant="solo-filled"
            density="compact"
            rounded="xl"
            flat
            hide-details
            prepend-inner-icon="mdi-gamepad-variant-outline"
            style="max-width: 320px; min-width: 220px"
          />
          <v-select
            v-model="profileId"
            :items="profileItems"
            :disabled="!titleId"
            :label="t('$vuetify.consoleLog.pickProfile')"
            variant="solo-filled"
            density="compact"
            rounded="xl"
            flat
            hide-details
            style="max-width: 280px; min-width: 200px"
          />
        </div>
        <AdminInsights
          v-if="titleId"
          :kind="profileId ? 'profile' : 'title'"
          :id="profileId || titleId"
          :log-height="$vuetify.display.height - 260"
        />
        <div v-else class="text-body-2 text-medium-emphasis pa-6 text-center">
          {{ t("$vuetify.consoleLog.pickHint") }}
        </div>
      </div>
    </Container>
  </div>
</template>
