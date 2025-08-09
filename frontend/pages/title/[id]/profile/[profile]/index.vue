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
  <div style="max-width: 900px">
    <v-card-title>{{ t("$vuetify.title.profile.routeSettings") }}</v-card-title>
    <v-card-subtitle>{{
      t("$vuetify.title.profile.routeDescription")
    }}</v-card-subtitle>
    <v-card-text>
      <v-row class="mb-5">
        <v-col
          v-if="
            (profile.flags & ProfileFlag.GAME) !== 0 &&
            profile.route_action == 'route'
          "
          cols="12"
          md="6"
        >
          <div class="text-caption ms-1 mb-1">
            {{ t("$vuetify.title.profile.tcpRoutes") }}
          </div>
          <v-number-input
            v-model:model-value="
              store.profileStates[profile.id].tcp_connections
            "
            :reverse="false"
            control-variant="hidden"
            :hideInput="false"
            density="comfortable"
            variant="solo-filled"
            :min="1"
            :max="1"
            :disabled="!store.connected"
            @update:model-value="() => store.saveActionProfile(profile.id)"
          />
        </v-col>
        <v-col
          v-if="
            (profile.flags & ProfileFlag.GAME) !== 0 &&
            profile.route_action == 'route'
          "
          cols="12"
          md="6"
        >
          <div class="text-caption ms-1 mb-1">
            {{ t("$vuetify.title.profile.udpRoutes") }}
          </div>
          <v-number-input
            v-model:model-value="
              store.profileStates[profile.id].udp_connections
            "
            :reverse="false"
            control-variant="stacked"
            :hideInput="false"
            density="comfortable"
            variant="solo-filled"
            :min="1"
            :max="4"
            :disabled="!store.connected"
            :loading="store.loadingProfileStates.includes(profile.id)"
            @update:model-value="() => store.saveActionProfile(profile.id)"
          />
        </v-col>
        <v-col v-if="profile.route_action != 'block'" cols="12">
          <v-select
            v-model:model-value="
              store.profileStates[profile.id].network_interfaces
            "
            :label="
              profile.route_action == 'route'
                ? t('$vuetify.title.profile.multiInternet')
                : t('$vuetify.title.profile.multiInternet')
            "
            :hint="t('$vuetify.title.profile.networkAdaptersHint')"
            :placeholder="
              t('$vuetify.title.profile.networkAdaptersPlaceholder')
            "
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
            variant="solo-filled"
            :multiple="profile.route_action == 'route'"
            :disabled="!store.connected"
            :loading="store.loadingProfileStates.includes(profile.id)"
            @update:model-value="() => store.saveActionProfile(profile.id)"
          />
        </v-col>
        <v-col v-if="profile.route_action == 'route'" cols="12">
          <v-checkbox
            v-model:model-value="
              store.profileStates[profile.id].allow_local_routes
            "
            :label="t('$vuetify.title.profile.allowLocalRoutes')"
            :hint="t('$vuetify.title.profile.allowLocalRoutesHint')"
            :disabled="!store.connected"
            :loading="store.loadingProfileStates.includes(profile.id)"
            @update:model-value="() => store.saveActionProfile(profile.id)"
          />
        </v-col>
      </v-row>

      <v-card
        v-if="(profile.flags & ProfileFlag.ALLOW_REGION_SELECTION) !== 0"
        prepend-icon="mdi-map-marker-radius"
        :title="t('$vuetify.title.profile.server.server')"
        :subtitle="t('$vuetify.title.profile.server.automaticServer')"
        :append-icon="
          locale.isRtl.value ? 'mdi-chevron-right' : 'mdi-chevron-left'
        "
        class="mt-5"
        :to="{
          name: 'title-id-profile-profile-server',
          params: {
            id: title?.id,
            profile: profile?.id,
          },
        }"
      >
        <v-card-text v-if="profile?.description?.length">
          {{ profile.description }}
        </v-card-text>
      </v-card>
      <v-card
        prepend-icon="mdi-network-outline"
        :title="t('$vuetify.title.profile.server.connections')"
        :subtitle="t('$vuetify.title.profile.server.connectionsSubtitle', [0])"
        class="mt-2"
        :append-icon="
          locale.isRtl.value ? 'mdi-chevron-right' : 'mdi-chevron-left'
        "
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
</template>
