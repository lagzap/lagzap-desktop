<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "@/stores";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import ProfileRouteSettings from "~/components/title/ProfileRouteSettings.vue";
import ProfileRegionSelection from "~/components/title/ProfileRegionSelection.vue";
import RouteDiagram from "~/components/title/RouteDiagram.vue";
import ProfileConnectionsTable from "~/components/title/ProfileConnectionsTable.vue";
import ProfilePingUsage from "~/components/title/ProfilePingUsage.vue";
import { ProfileFlag } from "~/constants/profile";
import { useProfileDisplayRoutes } from "~/composables/useProfileDisplayRoutes";

const props = defineProps<{
  profile: Profile;
}>();

const { connections } = useMonitoringStore();

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

const store = useStore();
const { numberOfRoutes } = useProfileDisplayRoutes(computed(() => props.profile));

const toggleProfile = async (profile: any) => {
  if (store.isProfileActive(profile.id)) {
    await store.deactivateProfile(profile.id);
  } else {
    await store.activateProfile(profile.id);
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
        @click.stop.prevent="toggleProfile(props.profile)"
      />
    </template>

    <template #append>
      <ProfileRegionSelection :profile="props.profile" />
      <ProfileRouteSettings :profile="props.profile" />
    </template>

    <v-card-subtitle v-if="props.profile.description" class="text-wrap mb-3">
      {{ store.localized(props.profile.description) }}
    </v-card-subtitle>

    <v-card-text v-if="showProfileSections" class="pt-0 profile-sections">
      <RouteDiagram :profile="props.profile" />
      <v-divider class="my-4" />
      <ProfilePingUsage :profile-id="props.profile.id" class="mb-4" />
      <ProfileConnectionsTable
        v-if="hasProfileConnections"
        :profile-id="props.profile.id"
        :limit="5"
      />
    </v-card-text>
  </v-card>
</template>
