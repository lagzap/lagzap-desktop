<script setup lang="ts">
import { computed } from "vue";
import { useStore } from "@/stores";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import ProfileRouteSettings from "~/components/title/ProfileRouteSettings.vue";
import ProfileRegionSelection from "~/components/title/ProfileRegionSelection.vue";
import ProfileActivityChip from "~/components/title/ProfileActivityChip.vue";
import ProfileEstimatedPing from "~/components/title/ProfileEstimatedPing.vue";
import ChangelogBadge from "~/components/title/ChangelogBadge.vue";
import RouteDiagram from "~/components/title/RouteDiagram.vue";
import ProfileConnectionsTable from "~/components/title/ProfileConnectionsTable.vue";
import ProfilePingUsage from "~/components/title/ProfilePingUsage.vue";
import { ProfileFlag } from "~/constants/profile";
import { useProfileChart } from "~/composables/useProfileChart";
import { FixProfileLag } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { useProfileConnectionStats } from "~/composables/useProfileConnectionStats";
import {
  BEST_INTERFACE,
  useProfileViewInterface,
} from "~/composables/useProfileViewInterface";
import { useLocale } from "vuetify";
import { isConnectionNotRelayed } from "~/composables/useRelayIssue";

const props = defineProps<{
  profile: Profile;
  /** Previous title visit time (ms) for changelog "new" detection. */
  changelogSince?: number | null;
}>();

const changelogHover = ref(false);

function onProfileFocusOut(event: FocusEvent) {
  const root = event.currentTarget as HTMLElement | null;
  const next = event.relatedTarget as Node | null;
  if (root && next && root.contains(next)) {
    return;
  }
  changelogHover.value = false;
}

function onProfileMouseLeave() {
  changelogHover.value = false;
}

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
const { settings } = useSettings();
const { rateProfile } = useSessionRating();
// Rating needs the session statistics, which follow "Send anonymous usage data".
const canRate = computed(() => settings.value.allowSendAnonymousData === true && store.isProfileActive(props.profile.id));
const { chart: profileChart, view: chartView } = useProfileChart(props.profile.id);

// Usage → the profile's traffic: the chart below when the card has one,
// else a popup with the same live chart.
const trafficDialog = ref(false);
function showTraffic() {
  const el = document.getElementById(`profile-chart-${props.profile.id}`);
  if (el) {
    chartView.value = "traffic";
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  trafficDialog.value = true;
}
const diagram = computed(() => profileChart.value?.diagram ?? null);
const interfaceRouteGroups = computed(() => diagram.value?.interfaces ?? []);
const canFixLag = computed(() => !!diagram.value?.show && !diagram.value?.idle);
// Go sets this while every route is losing packets.
const unstable = computed(() => profileChart.value?.latency?.unstable ?? null);
// LagZap just moved this game off a route that stopped working.
const { recent: protectedRecent } = useRouteProtection();
const routeProtected = computed(() => !unstable.value && !!protectedRecent.value[props.profile.id]);
// Go sets this while Smart mode keeps routes off a lagging transport.
const transportNote = computed(() => {
  const warning = profileChart.value?.latency?.transport;
  if (!warning || unstable.value || routeProtected.value) return null;
  const lagging = warning.lagging.toUpperCase();
  const using = warning.lagging === "udp" ? "TCP" : "UDP";
  const single = (profileChart.value?.interfaces?.length ?? 0) <= 1;
  return {
    text: single
      ? t("$vuetify.title.profile.transportLaggingSingle", lagging, using)
      : t("$vuetify.title.profile.transportLagging", lagging, warning.iface, using),
    tip: t("$vuetify.title.profile.transportLaggingTip", lagging, using),
  };
});
const fixingLag = ref(false);
async function fixLag() {
  if (fixingLag.value) return;
  fixingLag.value = true;
  try {
    await FixProfileLag(props.profile.id);
  } catch (error) {
    console.warn("fix lag failed:", error);
  } finally {
    fixingLag.value = false;
  }
}
const { selectedInterfaceKey } = useProfileViewInterface(props.profile.id);
// Smart routes are picked across all internets, so a per-NIC view would mislead.
const smartRoutes = computed(() => store.profileStates[props.profile.id]?.route_connections != null);
watch(smartRoutes, (on) => on && (selectedInterfaceKey.value = BEST_INTERFACE), { immediate: true });
const { connected, downloadSpeed, uploadSpeed, totalBytes } =
  useProfileConnectionStats(() => props.profile.id);

const showInterfaceSelector = computed(
  () => !!diagram.value?.show && interfaceRouteGroups.value.length > 1
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

const keepBypassSanctions = computed(
  () =>
    props.profile.route_action === "route" &&
    (props.profile.flags & ProfileFlag.BYPASS_SANCTIONS) !== 0
);

const profileDescription = computed(() => {
  const desc = props.profile.description;
  if (!desc || typeof desc !== "object") return "";
  return String(store.localized(desc as Record<string, string>) ?? "").trim();
});

const hasProfileDescription = computed(() => profileDescription.value.length > 0);

// Connections captured by LagZap but sent straight to the game server.
const { connections: monitoredConnections } = useMonitoringStore();
const notRelayedCount = computed(
  () =>
    (monitoredConnections.value ?? []).filter(
      (connection) =>
        connection.profile_id === props.profile.id &&
        isConnectionNotRelayed(connection)
    ).length
);

/** Same rules as ProfileActivityChip — usage replaces subtitle when live. */
const showUsageInSubtitle = computed(() => {
  if (
    !store.isProfileActive(props.profile.id) ||
    !store.appReady ||
    !connected.value
  ) {
    return false;
  }
  if (isHighTrafficProfile.value) {
    return totalBytes.value > 0 || downloadSpeed.value + uploadSpeed.value > 0;
  }
  return totalBytes.value > 0;
});

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
    const routeCount = diagram.value?.route_cap ?? 0;
    if (routeCount > 1) {
      parts.push(t("$vuetify.title.profile.subtitleRoutes", localDigits(routeCount)));
    }
  } else if (props.profile.route_action == "route") {
    if ((props.profile.flags & ProfileFlag.BYPASS_SANCTIONS) != 0) {
      parts.push(t("$vuetify.title.profile.bypassSanctions"));
    } else if ((props.profile.flags & ProfileFlag.GAME_PACKET) != 0) {
      parts.push(t("$vuetify.title.profile.latencyOptimizing"));
    } else {
      parts.push(t("$vuetify.title.profile.proxy"));
    }
  } else if (props.profile.route_action == "proxy") {
    parts.push(t("$vuetify.title.profile.proxy"));
  }

  if (
    props.profile.route_action == "route" &&
    profileState.allow_local_routes
  ) {
    parts.push(t("$vuetify.title.profile.domesticRoutes"));
  }

  // Add network interfaces info if custom
  const networkInterfaces = profileState.network_interfaces || [];
  if (networkInterfaces.length > 1) {
    parts.push(t("$vuetify.title.profile.internets", localDigits(networkInterfaces.length)));
  }

  return parts.length > 0 ? parts.join(" • ") : t("$vuetify.title.profile.defaultSettings");
});
</script>

<template>
  <v-card
    class="profile-card"
    :class="{ 'profile-card--inactive': !store.profileStates[props.profile.id] }"
    rounded="none"
    variant="flat"
    density="comfortable"
    color="transparent"
    @mouseenter="changelogHover = true"
    @mouseleave="onProfileMouseLeave"
    @focusin="changelogHover = true"
    @focusout="onProfileFocusOut"
  >
    <template #title>
      <div class="profile-card-title d-flex align-center ga-1 ms-3">
        <v-tooltip
          v-if="hasProfileDescription"
          location="top"
          open-delay="200"
          max-width="320"
        >
          <template #activator="{ props: tipProps }">
            <span
              v-bind="tipProps"
              class="text-subtitle-1 profile-card-title__name profile-card-title__name--has-desc"
            >
              {{ store.localized(props.profile.name) }}
            </span>
          </template>
          <span class="profile-card-title__desc">{{ profileDescription }}</span>
        </v-tooltip>
        <span v-else class="text-subtitle-1 profile-card-title__name">
          {{ store.localized(props.profile.name) }}
        </span>
        <ChangelogBadge
          dense
          hover-reveal
          :revealed="changelogHover"
          :entries="props.profile.updates"
          :since="props.changelogSince"
        />
      </div>
    </template>

    <template #subtitle>
      <span class="text-caption ms-3 profile-card-subtitle">
        <ProfileEstimatedPing
          :profile-id="props.profile.id"
          :views="showInterfaceSelector && !smartRoutes ? interfaceSelectItems : []"
          :can-fix-lag="canFixLag"
          :fixing-lag="fixingLag"
          @fix-lag="fixLag"
        />
        <template v-if="showUsageInSubtitle">
          <template v-if="keepBypassSanctions">
            <span>{{ t("$vuetify.title.profile.bypassSanctions") }}</span>
            <span class="profile-card-subtitle__sep">•</span>
          </template>
          <ProfileActivityChip :profile="props.profile" clickable @click="showTraffic" />
        </template>
        <template v-else>
          {{ routeSettingsText }}
        </template>
      </span>
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
      <v-tooltip v-if="canRate" :text="t('$vuetify.sessionRating.rateButton')" location="top" open-delay="300">
        <template #activator="{ props: tipProps }">
          <v-btn
            v-bind="tipProps"
            icon="mdi-star-outline"
            variant="text"
            size="small"
            :aria-label="t('$vuetify.sessionRating.rateButton')"
            @click="rateProfile(props.profile.id, props.profile.title_id, t('$vuetify.sessionRating.noSession'))"
          />
        </template>
      </v-tooltip>
      <ProfileRegionSelection :profile="props.profile" />
      <ProfileRouteSettings :profile="props.profile" />
    </template>

    <v-card-text
      v-if="
        showProfileSections ||
        (isHighTrafficProfile && store.isProfileActive(props.profile.id))
      "
      class="pt-0 profile-sections"
    >
      <template v-if="showProfileSections">
        <v-tooltip
          v-if="notRelayedCount > 0"
          :text="t('$vuetify.connections.profileNotRelayedHint')"
          location="top"
          max-width="320"
        >
          <template #activator="{ props: tipProps }">
            <div v-bind="tipProps" class="profile-protection d-flex align-center ga-2 mb-2">
              <v-icon icon="mdi-shield-alert-outline" size="16" color="warning" />
              <span>{{ t("$vuetify.connections.profileNotRelayed", notRelayedCount) }}</span>
            </div>
          </template>
        </v-tooltip>
        <RouteDiagram :profile="props.profile" />
        <!-- Always laid out, only shown with a warning: no jump in card height. -->
        <v-tooltip :disabled="!transportNote" location="bottom" max-width="320" open-delay="200">
          <template #activator="{ props: tipProps }">
            <div
              v-bind="tipProps"
              class="profile-protection d-flex align-center ga-2 mt-2"
              :style="{ visibility: unstable || routeProtected || transportNote ? 'visible' : 'hidden' }"
              :aria-hidden="!unstable && !routeProtected && !transportNote"
            >
              <v-icon v-if="routeProtected" icon="mdi-check-circle" size="16" color="success" />
              <v-icon v-else :icon="transportNote ? 'mdi-swap-horizontal' : 'mdi-shield-alert'" size="16" color="warning" />
              <span v-if="routeProtected">{{ t("$vuetify.status.routeProtectedGeneric") }}</span>
              <span v-else>{{ transportNote ? transportNote.text : t("$vuetify.networkLatency.unstableNote") }}</span>
            </div>
          </template>
          {{ transportNote?.tip }}
        </v-tooltip>
        <v-divider class="my-4" />
      </template>
      <ProfilePingUsage :profile-id="props.profile.id" class="mb-4" />
      <ProfileConnectionsTable
        v-if="showProfileSections && hasProfileConnections"
        :profile-id="props.profile.id"
        :limit="5"
      />
    </v-card-text>

    <v-dialog v-model="trafficDialog" max-width="640">
      <v-card rounded="xl">
        <v-card-item>
          <v-card-title>{{ store.localized(props.profile.name) }}</v-card-title>
          <v-card-subtitle>{{ t("$vuetify.networkLatency.traffic") }}</v-card-subtitle>
          <template #append>
            <v-btn icon="mdi-close" variant="text" size="small" @click="trafficDialog = false" />
          </template>
        </v-card-item>
        <v-card-text>
          <ProfilePingUsage v-if="trafficDialog" :profile-id="props.profile.id" traffic-only />
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<style scoped>

.profile-card-subtitle {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.profile-card-title {
  min-width: 0;
}

.profile-card-title__name--has-desc {
  cursor: help;
  text-decoration: underline dotted;
  text-decoration-thickness: 1px;
  text-underline-offset: 0.2em;
  text-decoration-color: rgba(var(--v-theme-on-surface), 0.35);
}

.profile-card-title__desc {
  display: inline-block;
  line-height: 1.4;
  white-space: normal;
}

.profile-card--inactive {
  opacity: 0.55;
}

.profile-card-subtitle__sep {
  opacity: 0.45;
}

.profile-protection {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.75rem;
  line-height: 1.3;
}
</style>
