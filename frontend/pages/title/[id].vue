<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import { useStore } from "@/stores";
import { useLocale } from "vuetify";

const locale = useLocale();
const store = useStore();
const route = useRoute();
const router = useRouter();
const data = useSanctumUser<DataResponse>();

const title = computed(() =>
  store.titles.find((t) => t.id === (route.params.id as string))
);
const profile = computed(() =>
  store.profiles.find((p) => p.id === (route.params.profile as string))
);

onMounted(() => {
  nextTick(() => {
    if (!title.value || !store.connected) {
      return;
    }
    store.visitTitle(title.value.id);
  });
});
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-btn
          v-if="
            [
              'title-id-profile-profile',
              'title-id-profile-profile-server',
              'title-id-profile-profile-connections',
            ].includes(route.name as string)
          "
          :icon="locale.isRtl.value ? 'mdi-arrow-right' : 'mdi-arrow-left'"
          @click="router.back()"
        />
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
          :style="{
            cursor: route.name != 'title-id' ? 'pointer' : 'default',
          }"
          class="text-subtitle-1"
          @click="
            router.push(
              profile
                ? {
                    name: 'title-id-profile-profile',
                    params: { id: title.id, profile: profile.id },
                  }
                : { name: 'title-id', params: { id: title.id } }
            )
          "
        >
          {{
            profile
              ? store.localized(profile.name)
              : store.localized(title?.name)
          }}
        </v-app-bar-title>
      </template>

      <NuxtPage
        :transition="{
          name: 'slide-x-transition',
          mode: 'in-out',
          persisted: true,
        }"
      />
      <template v-if="title && !profile" #outside>
        <v-fab
          v-if="store.isTitleActive(title.id)"
          :active="route.name === 'title-id'"
          icon
          appear
          size="x-large"
          color="green"
          variant="elevated"
          :style="{
            position: 'fixed',
            bottom: '24px',
            [locale.isRtl.value ? 'left' : 'right']: '24px',
            zIndex: 10000,
          }"
          :disabled="!store.connected"
          @click="store.toggleTitleState(title)"
        >
          <v-icon>mdi-pause</v-icon>
        </v-fab>
        <v-fab
          v-else
          :active="route.name === 'title-id'"
          icon
          appear
          size="x-large"
          color="secondary"
          variant="elevated"
          :style="{
            position: 'fixed',
            bottom: '24px',
            [locale.isRtl.value ? 'left' : 'right']: '24px',
            zIndex: 10000,
          }"
          :disabled="!store.connected"
          @click="store.toggleTitleState(title)"
        >
          <v-icon>mdi-play</v-icon>
        </v-fab>
      </template>
    </Container>
  </div>
</template>
