<script setup lang="ts">
import { useStore } from "@/stores";
import { useLocale } from "vuetify";
import { ProfileFlag } from "~/constants/profile";

const locale = useLocale();
const { t } = locale;
const store = useStore();
const route = useRoute();
const router = useRouter();

const { connections } = useMonitoringStore();
const title = computed(() =>
  store.titles.find((t) => t.id === (route.params.id as string))
);
const activeConnections = computed(
  () => connections.value?.filter((c) => c.title_id == title.value.id) ?? []
);

const toggleProfile = async (profile: any) => {
  if (!title.value) return;

  if (store.isProfileActive(profile.id)) {
    await store.deactivateProfile(profile.id);
  } else {
    await store.activateProfile(profile.id);
  }
};
</script>

<template>
  <div>
    <v-card-text>
      <v-card
        prepend-icon="mdi-network-outline"
        :title="t('$vuetify.connections.connections')"
        :subtitle="
          t('$vuetify.connections.connectionsSubtitle', [
            activeConnections.length,
          ])
        "
        class="mt-2 mb-2"
        :append-icon="
          locale.isRtl.value ? 'mdi-chevron-left' : 'mdi-chevron-right'
        "
        :to="{
          name: 'title-id-connections',
          params: {
            id: title?.id,
          },
        }"
      />
      <v-row v-if="title" dense>
        <v-col
          v-for="profile in store.profiles
            .filter((p) => p.title_id === title.id)
            .sort((a, b) => a.order - b.order)"
          :key="profile.id"
          cols="12"
          xl="4"
          lg="6"
        >
          <v-card
            :title="store.localized(profile.name)"
            :append-icon="
              locale.isRtl.value ? 'mdi-chevron-left' : 'mdi-chevron-right'
            "
            height="100%"
            @click="
              router.push(
                profile.route_action == 'route'
                  ? {
                      name: 'title-id-profile-profile-server',
                      params: {
                        id: title.id,
                        profile: profile.id,
                      },
                    }
                  : profile.route_action != 'block'
                  ? {
                      name: 'title-id-profile-profile',
                      params: {
                        id: title.id,
                        profile: profile.id,
                      },
                    }
                  : {
                      name: 'title-id-profile-profile-geofence',
                      params: {
                        id: title.id,
                        profile: profile.id,
                      },
                    }
              )
            "
          >
            <template #title>
              {{ store.localized(profile.name) }}
            </template>
            <template v-if="store.profileStates[profile.id]" #subtitle>
              <template v-if="profile.route_action == 'route'">
                <span
                  v-if="profile.flags & ProfileFlag.MULTIPATH"
                  class="text-sm"
                >
                  <span>
                    Routes:
                    <span class="text-blue">{{
                      store.profileStates?.[profile.id].udp_connections
                    }}</span>
                  </span>
                </span>
              </template>
              <span v-if="profile.route_action == 'direct'">
                <span>{{
                  store.profileStates?.[profile.id].network_interfaces?.[0] ??
                  "-"
                }}</span>
              </span>
              <span v-if="profile.route_action == 'block'">
                {{ t("$vuetify.title.profile.geofence") }}
              </span>

              <span
                v-if="
                  (profile.flags & ProfileFlag.ALLOW_REGION_SELECTION) != 0 &&
                  profile.route_action == 'route'
                "
                class="text-sm"
              >
                <span v-if="store.profileStates[profile.id].mode == 0">{{
                  t("$vuetify.routingMode.global")
                }}</span>
                <span v-if="store.profileStates[profile.id].mode == 1">{{
                  t("$vuetify.routingMode.regional")
                }}</span>
                <span v-if="store.profileStates[profile.id].mode == 2">{{
                  t("$vuetify.routingMode.country")
                }}</span>
                <span v-if="store.profileStates[profile.id].mode == 3">{{
                  t("$vuetify.routingMode.city")
                }}</span>
              </span>
            </template>
            <template v-slot:prepend>
              <v-switch
                :model-value="store.isProfileActive(profile.id)"
                density="comfortable"
                hide-details
                inset
                color="cyan"
                class="me-3"
                :disabled="!store.connected"
                :loading="store.loadingProfileStates.includes(profile.id)"
                @click.stop.prevent="toggleProfile(profile)"
              />
            </template>
            <template v-if="profile.route_action != 'block'" v-slot:append>
              <v-tooltip
                v-if="
                  (profile.flags & ProfileFlag.ALLOW_REGION_SELECTION) !== 0
                "
                location="bottom"
              >
                <template #activator="{ props }">
                  <v-btn
                    variant="plain"
                    color="secondary"
                    density="comfortable"
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
                <span>{{ t("$vuetify.title.locations") }}</span>
              </v-tooltip>
              <v-tooltip
                v-if="profile.route_action == 'route'"
                location="bottom"
              >
                <template #activator="{ props }">
                  <v-btn
                    :variant="
                      activeConnections.filter(
                        (x) => x.profile_id == profile.id
                      ).length
                        ? 'text'
                        : 'plain'
                    "
                    color="secondary"
                    density="comfortable"
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
                <span>{{
                  t("$vuetify.connections.connectionsSubtitle", [
                    activeConnections.filter((x) => x.profile_id == profile.id)
                      .length,
                  ])
                }}</span>
              </v-tooltip>
              <v-tooltip location="bottom">
                <template #activator="{ props }">
                  <v-btn
                    variant="plain"
                    color="secondary"
                    density="comfortable"
                    icon="mdi-cog-play"
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
                <span>{{ t("$vuetify.title.advancedOptions") }}</span>
              </v-tooltip>
            </template>

            <v-card-text
              v-if="profile?.description?.[locale.current.value]?.length"
            >
              <span class="text-caption">{{
                profile.description[locale.current.value]
              }}</span>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-card-text>
  </div>
</template>
