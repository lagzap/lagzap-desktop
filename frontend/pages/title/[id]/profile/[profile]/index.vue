<script setup lang="ts">
import { useStore } from "@/stores";
import { useLocale } from "vuetify";
import { GetInterfaces } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { ProfileFlag } from "~/constants/profile";

const locale = useLocale();
const { t } = locale;
const store = useStore();
const route = useRoute();

const title = computed(() =>
  store.titles.find((t) => t.id === (route.params.id as string))
);
const profile = computed(() =>
  store.profiles.find((p) => p.id === (route.params.profile as string))
);

const [defaultInterface, interfaces] = await GetInterfaces();

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
  <div v-if="true" style="max-width: 900px">
    <v-card-title>Route Settings</v-card-title>
    <v-card-subtitle>
      options to configure your routing preferences
    </v-card-subtitle>
    <v-card-text>
      <v-row>
        <v-col v-if="(profile.flags & ProfileFlag.GAME) !== 0" cols="12" md="6">
          <div class="text-caption ms-1 mb-1">TCP Routes</div>
          <v-number-input
            v-model:model-value="
              store.profileStates[profile.id].tcp_connections
            "
            :reverse="false"
            control-variant="split"
            :hideInput="false"
            inset
            density="comfortable"
            variant="outlined"
            :min="1"
            :max="4"
            :disabled="!store.connected"
            :loading="store.loadingProfileStates.includes(profile.id)"
            @update:model-value="() => store.saveActionProfile(profile.id)"
          />
        </v-col>
        <v-col v-if="(profile.flags & ProfileFlag.GAME) !== 0" cols="12" md="6">
          <div class="text-caption ms-1 mb-1">UDP Routes</div>
          <v-number-input
            v-model:model-value="
              store.profileStates[profile.id].udp_connections
            "
            :reverse="false"
            control-variant="split"
            :hideInput="false"
            inset
            density="comfortable"
            variant="outlined"
            :min="1"
            :max="4"
            :disabled="!store.connected"
            :loading="store.loadingProfileStates.includes(profile.id)"
            @update:model-value="() => store.saveActionProfile(profile.id)"
          />
        </v-col>
        <v-col cols="12">
          <v-select
            v-model:model-value="
              store.profileStates[profile.id].network_interfaces
            "
            :label="`Automatic (${defaultInterface.Name})`"
            :hint="t('$vuetify.settings.interfacesHint')"
            placeholder="Leave empty for automatic selection"
            persistent-hint
            :items="
              interfaces
                .filter(
                  (i) =>
                    (i.Flags & 1) == 1 &&
                    (i.Flags & 32) == 32 &&
                    (i.Flags & 4) == 0
                )
                .sort((a, b) => a.Name.localeCompare(b.Name))
            "
            item-value="Name"
            item-title="Name"
            density="comfortable"
            variant="outlined"
            multiple
            chips
            :disabled="!store.connected"
            :loading="store.loadingProfileStates.includes(profile.id)"
            @update:model-value="() => store.saveActionProfile(profile.id)"
          />
        </v-col>
        <v-col cols="12">
          <v-checkbox
            v-model:model-value="
              store.profileStates[profile.id].allow_local_routes
            "
            label="Use servers located in my region to re-route"
            hint="Causes traffic to be routed through servers in your country or state/province"
            :disabled="!store.connected"
            :loading="store.loadingProfileStates.includes(profile.id)"
            @update:model-value="() => store.saveActionProfile(profile.id)"
          />
        </v-col>
      </v-row>

      <v-card
        prepend-icon="mdi-map-marker-radius"
        title="Server"
        :subtitle="t('$vuetify.server.automaticServer')"
        :append-icon="locale.isRtl ? 'mdi-chevron-right' : 'mdi-chevron-left'"
        class="mt-5"
        :to="
          (profile.flags & ProfileFlag.ALLOW_REGION_SELECTION) !== 0
            ? {
                name: 'title-id-profile-profile-server',
                params: {
                  id: title?.id,
                  profile: profile?.id,
                },
              }
            : undefined
        "
      >
        <v-card-text v-if="profile?.description?.length">
          {{ profile.description }}
        </v-card-text>
      </v-card>
      <v-card
        prepend-icon="mdi-network-outline"
        title="Connections"
        subtitle="0 active connections"
        class="mt-2"
        :append-icon="locale.isRtl ? 'mdi-chevron-right' : 'mdi-chevron-left'"
        :to="{
          name: 'title-id-profile-profile-connections',
          params: {
            id: title?.id,
            profile: profile?.id,
          },
        }"
      />
    </v-card-text>
  </div>
  <v-card-text v-else>
    <v-empty-state title="Profile could not be found" />
  </v-card-text>
</template>
