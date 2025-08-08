<script setup lang="ts">
import { useStore } from "@/stores";
import { useLocale } from "vuetify";
import { ProfileFlag } from "~/constants/profile";

const locale = useLocale();
const { t } = locale;
const store = useStore();
const route = useRoute();
const router = useRouter();

const title = computed(() =>
  store.titles.find((t) => t.id === (route.params.id as string))
);

const toggleProfile = async (profile: any) => {
  if (!title.value) return;

  if (store.isProfileActive(profile.id)) {
    await store.deactivateProfile(profile.id);
  } else {
    await store.activateProfile(profile.id);
  }
};

onMounted(() => {
  nextTick(() => {
    if (!title.value) {
      return;
    }
    store.visitTitle(title.value.id);
  });
});
</script>

<template>
  <div>
    <v-card-title> Profiles </v-card-title>
    <v-card-subtitle>
      Select the profiles and manage them as you'd like lagzap to handle the
      connections.
    </v-card-subtitle>
    <v-card-text>
      <v-row v-if="title">
        <v-col
          v-for="profile in store.profiles.filter(
            (p) => p.title_id === title.id
          )"
          :key="profile.id"
          cols="12"
          xl="4"
          lg="6"
        >
          <v-card
            :title="store.localized(profile.name)"
            :subtitle="t('$vuetify.server.automaticServer')"
            :append-icon="
              locale.isRtl ? 'mdi-chevron-right' : 'mdi-chevron-left'
            "
            @click="
              router.push({
                name: 'title-id-profile-profile',
                params: {
                  id: title.id,
                  profile: profile.id,
                },
              })
            "
          >
            <template v-slot:prepend>
              <v-switch
                :model-value="store.isProfileActive(profile.id)"
                inset
                hide-details
                intermediate
                class="me-4"
                color="green"
                :disabled="!store.connected"
                :loading="store.loadingProfileStates.includes(profile.id)"
                @click.stop.prevent="toggleProfile(profile)"
              />
            </template>
            <template v-slot:append>
              <v-tooltip location="bottom">
                <template #activator="{ props }">
                  <v-btn
                    variant="text"
                    color="secondary"
                    icon="mdi-network-outline"
                    :to="{
                      name: 'title-id-profile-profile-connections',
                      params: {
                        id: title.id,
                        profile: profile.id,
                      },
                    }"
                    v-bind="props"
                    @click.stop
                  />
                </template>
                <span>Connections</span>
              </v-tooltip>
              <v-tooltip
                v-if="
                  (profile.flags & ProfileFlag.ALLOW_REGION_SELECTION) !== 0
                "
                location="bottom"
              >
                <template #activator="{ props }">
                  <v-btn
                    variant="text"
                    color="secondary"
                    icon="mdi-map-marker-radius"
                    :to="{
                      name: 'title-id-profile-profile-server',
                      params: {
                        id: title.id,
                        profile: profile.id,
                      },
                    }"
                    v-bind="props"
                    @click.stop
                  />
                </template>
                <span>Server Locations</span>
              </v-tooltip>
              <v-tooltip location="bottom">
                <template #activator="{ props }">
                  <v-btn
                    variant="plain"
                    color="secondary"
                    icon="mdi-dots-vertical"
                    :to="{
                      name: 'title-id-profile-profile',
                      params: {
                        id: title.id,
                        profile: profile.id,
                      },
                    }"
                    v-bind="props"
                    @click.stop
                  />
                </template>
                <span>Advanced Options</span>
              </v-tooltip>
            </template>

            <v-card-text v-if="profile?.description?.length">
              {{ profile.description }}
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-card-text>
  </div>
</template>
