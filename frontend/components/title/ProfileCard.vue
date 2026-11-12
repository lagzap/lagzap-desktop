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
import LinkQualityIndicator from "~/components/title/LinkQualityIndicator.vue";
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
import { usePlanAccess } from "~/composables/usePlanAccess";
import RouteLevelText from "~/components/plan/RouteLevelText.vue";

const props = defineProps<{
  profile: Profile;
  /** Previous title visit time (ms) for changelog "new" detection. */
  changelogSince?: number | null;
}>();

const changelogHover = ref(false);
// Report a problem: the bug dialog, subject prefilled with this profile.
const reportOpen = ref(false);

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
const { profileLocked, profileUnavailable, canUpgrade, openUpgrade } = usePlanAccess();
/** Not in the user's plan: shown with the unlock offer, never turned on. */
const locked = computed(() => profileLocked(props.profile.id));
/** No plan offers it yet: a gray lock, nothing to purchase or pick. */
const unavailable = computed(() => profileUnavailable(props.profile.id));
const { settings } = useSettings();
const { rateProfile } = useSessionRating();
// Rating needs the session statistics, which follow "Send anonymous usage data".
const canRate = computed(() => settings.value.allowSendAnonymousData === true && store.isProfileActive(props.profile.id));
const { chart: profileChart, view: chartView } = useProfileChart(props.profile.id);

// Usage → the profile's traffic: the chart below when the card has one,
// else a popup with the same live chart.
const trafficDialog = ref(false);
/** The ping switches the chart below to Latency where it is, without
 * scrolling (the ping itself measures the routes again). */
function showLatency() {
  chartView.value = "latency";
}
function showTraffic() {
  chartView.value = "traffic";
  const el = document.getElementById(`profile-chart-${props.profile.id}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  trafficDialog.value = true;
}
const diagram = computed(() => profileChart.value?.diagram ?? null);
/** Route levels for this profile: the plan's level (shown, as in Route
 * Settings) and what a higher one measured. The level of the route in use
 * is not shown: the fastest route can be a short one on any plan. */
const routeLevel = computed(() => diagram.value?.level ?? null);
const interfaceRouteGroups = computed(() => diagram.value?.interfaces ?? []);
const canFixLag = computed(() => !!diagram.value?.show && !diagram.value?.idle);
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


const profileDescription = computed(() => {
  const desc = props.profile.description;
  if (!desc || typeof desc !== "object") return "";
  return String(store.localized(desc as Record<string, string>) ?? "").trim();
});

const hasProfileDescription = computed(() => profileDescription.value.length > 0);

// Connections LagZap rejected: no server in the profile's location could carry them.
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
          @show-latency="showLatency"
        >
          <template #after-value>
            <LinkQualityIndicator v-if="profileChart?.link" :link="profileChart.link" />
          </template>
        </ProfileEstimatedPing>
        <!-- The ping already ends with a separator. While a session runs,
             its speed and traffic take the place of the route level and
             the profile's options. -->
        <ProfileActivityChip v-if="showUsageInSubtitle" :profile="props.profile" clickable @click="showTraffic" />
        <template v-else>
          <template v-if="routeLevel?.plan">
            <RouteLevelText :level="routeLevel.plan" />
            <span class="profile-card-subtitle__sep">•</span>
          </template>
          {{ routeSettingsText }}
        </template>
      </span>
    </template>

    <template #prepend>
      <!-- Not in the plan: the switch stays, disabled and halfway, with a lock
           in its thumb. -->
      <v-switch
        v-if="locked || unavailable"
        inset
        density="compact"
        :model-value="null"
        indeterminate
        hide-details
        disabled
        class="profile-card__locked-switch"
      >
        <template #thumb>
          <v-icon icon="mdi-lock" size="12" />
        </template>
      </v-switch>
      <v-switch
        v-else
        inset
        density="compact"
        :model-value="store.isProfileActive(props.profile.id)"
        hide-details
        color="cyan"
        :disabled="!store.appReady || locked || unavailable || store.planBlocked"
        @update:model-value="toggleProfile"
      />
    </template>

    <template #append>
      <v-tooltip :text="t('$vuetify.tickets.reportProblem')" location="top" open-delay="300">
        <template #activator="{ props: tipProps }">
          <!-- Shown on hover like the changelog, in its color. -->
          <v-btn
            v-bind="tipProps"
            class="profile-report"
            :class="{ 'profile-report--hidden': !changelogHover && !reportOpen }"
            variant="text"
            size="small"
            icon
            :tabindex="changelogHover ? 0 : -1"
            :aria-label="t('$vuetify.tickets.reportProblem')"
            @click="reportOpen = true"
          >
            <v-icon class="profile-report__icon" icon="mdi-bug-outline" size="18" />
          </v-btn>
        </template>
      </v-tooltip>
      <DialogBugFeedback
        v-model="reportOpen"
        :subject="t('$vuetify.tickets.reportSubject', store.localized(props.profile.name))"
      />
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
      <v-btn
        v-if="locked"
        class="profile-card__unlock text-none"
        variant="flat"
        color="amber"
        prepend-icon="mdi-lock-open-variant"
        :disabled="!canUpgrade"
        @click.stop="openUpgrade"
      >
        {{ t("$vuetify.plan.unlock") }}
      </v-btn>
      <ProfileRegionSelection v-else-if="!unavailable" :profile="props.profile" />
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
        <!-- The notice sits on the chart's bottom-left corner (loss and
             bursts take the bottom-right), so the chart has the whole area. -->
        <div class="profile-diagram">
          <RouteDiagram :profile="props.profile" />
        </div>
      </template>
      <ProfilePingUsage :profile-id="props.profile.id" :divided="showProfileSections" class="mb-4" />
      <ProfileConnectionsTable
        v-if="showProfileSections && hasProfileConnections"
        :profile-id="props.profile.id"
        :limit="3"
      />
    </v-card-text>

    <v-dialog v-model="trafficDialog" max-width="640">
      <v-card rounded="xl">
        <v-card-item>
          <v-card-title>{{ store.localized(props.profile.name) }}</v-card-title>
          <template #append>
            <v-btn icon="mdi-close" variant="text" size="small" @click="trafficDialog = false" />
          </template>
        </v-card-item>
        <v-card-text>
          <ProfilePingUsage v-if="trafficDialog" :profile-id="props.profile.id" popup />
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<style scoped>
/* Nothing in it yet (a High traffic profile before its first traffic: the
 * chart only grows in with data): no empty padding under the header. */
.profile-sections:not(:has(> *)) {
  display: none;
}


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

.profile-diagram {
  position: relative;
}

.profile-diagram__notice {
  position: absolute;
  left: 0;
  bottom: 0;
  max-width: calc(100% - 150px);
  z-index: 1;
}

/* A wrapped notice keeps its icon on the first line, not between lines. */
.profile-notice {
  line-height: 16px;
}

.profile-notice .v-icon {
  flex-shrink: 0;
}

.profile-report {
  transition: opacity 0.12s ease;
}

.profile-report--hidden {
  opacity: 0;
  pointer-events: none;
}

.profile-report__icon {
  color: rgba(var(--v-theme-on-surface), 0.38);
}

.profile-preview-note__title {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.profile-card__locked-switch :deep(.v-switch__thumb) {
  color: rgba(0, 0, 0, 0.6);
}

.profile-notice--upgrade {
  cursor: pointer;
}

.profile-notice--upgrade:hover {
  text-decoration: underline;
}

.profile-card-subtitle__level {
  white-space: nowrap;
}
</style>
