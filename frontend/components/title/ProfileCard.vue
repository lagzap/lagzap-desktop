<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "@/stores";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import ProfileRouteSettings from "~/components/title/ProfileRouteSettings.vue";
import ProfileRegionSelection from "~/components/title/ProfileRegionSelection.vue";
import ProfileActivityChip from "~/components/title/ProfileActivityChip.vue";
import RouteDiagram from "~/components/title/RouteDiagram.vue";
import ProfileConnectionsTable from "~/components/title/ProfileConnectionsTable.vue";
import ProfilePingUsage from "~/components/title/ProfilePingUsage.vue";
import { ProfileFlag } from "~/constants/profile";
import { useProfileDisplayRoutes } from "~/composables/useProfileDisplayRoutes";
import {
  BEST_INTERFACE,
  useProfileViewInterface,
} from "~/composables/useProfileViewInterface";
import { useLocale } from "vuetify";

const props = defineProps<{
  profile: Profile;
}>();

const { connections } = useMonitoringStore();
const { t } = useLocale();

const hasProfileConnections = computed(() =>
  (connections.value ?? []).some(
    (connection) => connection.profile_id === props.profile.id
  )
);

const showProfileSections = computed(
  () =>
    (props.profile.flags &
      (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET)) !==
    0
);

const isHighTrafficProfile = computed(
  () => (props.profile.flags & ProfileFlag.HIGH_TRAFFIC) !== 0
);

const store = useStore();
const { numberOfRoutes, interfaceRouteGroups, shouldShowRoutes } =
  useProfileDisplayRoutes(computed(() => props.profile));
const { selectedInterfaceKey } = useProfileViewInterface(props.profile.id);

const showInterfaceSelector = computed(
  () => shouldShowRoutes.value && interfaceRouteGroups.value.length > 1
);

const interfaceSelectItems = computed(() => [
  {
    title: t("$vuetify.title.profile.bestInternet"),
    value: BEST_INTERFACE,
  },
  ...interfaceRouteGroups.value.map((group) => ({
    title: group.name,
    value: group.name,
  })),
]);

const toggleProfile = async (wantOn: boolean | null) => {
  if (wantOn == null || !store.appReady) {
    return;
  }
  const active = store.isProfileActive(props.profile.id);
  if (wantOn === active) {
    return;
  }
  if (active) {
    await store.deactivateProfile(props.profile.id);
  } else {
    await store.activateProfile(props.profile.id);
  }
};

// Computed property for route settings summary (for subtitle)
const routeSettingsText = computed(() => {
  const profileState = store.profileStates[props.profile.id];
  if (!profileState) return "—";

  const parts = [];

  // Add connection info
  if (
    (props.profile.flags & ProfileFlag.MULTIPATH) != 0 &&
    props.profile.route_action == "route"
  ) {
    const routeCount = numberOfRoutes.value;
    if (routeCount > 1) {
      parts.push(`${routeCount} Routes`);
    }
  } else if (props.profile.route_action == "route") {
    if ((props.profile.flags & ProfileFlag.BYPASS_SANCTIONS) != 0) {
      parts.push("Bypass Sanctions");
    } else if ((props.profile.flags & ProfileFlag.GAME_PACKET) != 0) {
      parts.push("Latency Optimizing");
    } else {
      parts.push("Proxy");
    }
  } else if (props.profile.route_action == "proxy") {
    parts.push("Proxy");
  }

  if (
    props.profile.route_action == "route" &&
    profileState.allow_local_routes
  ) {
    parts.push("Domestic routes");
  }

  // Add network interfaces info if custom
  const networkInterfaces = profileState.network_interfaces || [];
  if (networkInterfaces.length > 1) {
    parts.push(
      `${networkInterfaces.length} internet${
        networkInterfaces.length > 1 ? "s" : ""
      }`
    );
  }

  return parts.length > 0 ? parts.join(" • ") : "Default settings";
});
</script>

<template>
  <v-card
    rounded="none"
    variant="flat"
    density="comfortable"
    color="transparent"
    :disabled="!store.profileStates[props.profile.id]"
  >
    <template #title>
      <span class="text-subtitle-1 ms-3">{{
        store.localized(props.profile.name)
      }}</span>
    </template>

    <template #subtitle>
      <span class="text-caption ms-3">{{ routeSettingsText }}</span>
    </template>

    <template #prepend>
      <v-switch
        inset
        density="compact"
        :model-value="store.isProfileActive(props.profile.id)"
        hide-details
        color="cyan"
        :disabled="!store.appReady"
        @update:model-value="toggleProfile"
      />
    </template>

    <template #append>
      <ProfileActivityChip :profile="props.profile" />
      <ProfileRegionSelection :profile="props.profile" />
      <ProfileRouteSettings :profile="props.profile" />
    </template>

    <v-card-subtitle v-if="props.profile.description" class="text-wrap mb-3">
      {{ store.localized(props.profile.description) }}
    </v-card-subtitle>

    <v-card-text
      v-if="
        showProfileSections ||
        (isHighTrafficProfile && store.isProfileActive(props.profile.id))
      "
      class="pt-0 profile-sections"
    >
      <template v-if="showProfileSections">
        <RouteDiagram :profile="props.profile" />
        <div
          v-if="showInterfaceSelector"
          class="profile-interface-selector d-flex justify-start mt-2 mb-2"
        >
          <v-select
            v-model="selectedInterfaceKey"
            :items="interfaceSelectItems"
            :label="t('$vuetify.title.profile.interface')"
            density="compact"
            hide-details
            single-line
            variant="outlined"
            class="profile-interface-selector__select"
          />
        </div>
        <v-divider class="my-4" />
      </template>
      <ProfilePingUsage :profile-id="props.profile.id" class="mb-4" />
      <ProfileConnectionsTable
        v-if="showProfileSections && hasProfileConnections"
        :profile-id="props.profile.id"
        :limit="5"
      />
    </v-card-text>
  </v-card>
</template>

<style scoped>
.profile-interface-selector__select {
  min-width: 180px;
  max-width: 260px;
}
</style>
