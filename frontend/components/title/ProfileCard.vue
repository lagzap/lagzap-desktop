<script setup lang="ts">
import { computed } from "vue";
import { useLocalStorage, useResizeObserver } from "@vueuse/core";
import { useProfileEstimate } from "~/composables/useProfileChart";
import { useRouteLine } from "~/composables/useRouteLine";
import { useTitleMenu } from "~/composables/useTitleMenu";
import QuickLocation from "~/components/title/QuickLocation.vue";
import ProfileCapButton from "~/components/title/ProfileCapButton.vue";
import LinkQualityIndicator from "~/components/title/LinkQualityIndicator.vue";
import { useStore } from "@/stores";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import ProfileRouteSettings from "~/components/title/ProfileRouteSettings.vue";
import ProfileRegionSelection from "~/components/title/ProfileRegionSelection.vue";
import WireGuardHint from "~/components/title/WireGuardHint.vue";
import ProfileActivityChip from "~/components/title/ProfileActivityChip.vue";
import ProfileEstimatedPing from "~/components/title/ProfileEstimatedPing.vue";
import ChangelogBadge from "~/components/title/ChangelogBadge.vue";
import RouteLine from "~/components/title/RouteLine.vue";
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
import { usePlanAccess } from "~/composables/usePlanAccess";
import RouteLevelText from "~/components/plan/RouteLevelText.vue";
import MultiInternetHint from "~/components/title/MultiInternetHint.vue";
import MultipathOffHint from "~/components/title/MultipathOffHint.vue";
import BetterInternetHint from "~/components/title/BetterInternetHint.vue";
import AdminLogDialog from "~/components/admin/AdminLogDialog.vue";

const props = defineProps<{
  profile: Profile;
  /** Previous title visit time (ms) for changelog "new" detection. */
  changelogSince?: number | null;
  /** The game's main profile: big ping, route line and chart up front. */
  featured?: boolean;
  /** The title has only this profile: its switch is the title's own. */
  single?: boolean;
  /** The game's name and icon, the route diagram's last stop. */
  gameName?: string;
  gameIcon?: string | null;
}>();

const changelogHover = ref(false);
// Admins: this profile's connections' console lines.
const logOpen = ref(false);
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

const profileConnectionCount = computed(
  () => (connections.value ?? []).filter((connection) => connection.profile_id === props.profile.id).length
);
const hasProfileConnections = computed(() => profileConnectionCount.value > 0);
/** The chart is drawn (it has a line): the connections toggle sits in it. */
const chartHasData = computed(
  () => !!profileChart.value?.latency?.series?.length || !!profileChart.value?.traffic?.series?.length,
);
const showConns = useLocalStorage(`lz-profile-conns-open-${props.profile.id}`, false);

const showProfileSections = computed(
  () =>
    (props.profile.flags &
      (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET)) !==
    0
);

const isHighTrafficProfile = computed(
  () => (props.profile.flags & ProfileFlag.HIGH_TRAFFIC) !== 0
);

/** Downloads and updates (load balanced, never a game or a backup one). */
const isDownloadProfile = computed(
  () =>
    isHighTrafficProfile.value &&
    (props.profile.flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET | ProfileFlag.PREVENT_DISCONNECT)) === 0,
);

/** A game: its packets are optimized (Multi Internet or not). */
const isGameProfile = computed(() => (props.profile.flags & ProfileFlag.GAME_PACKET) !== 0);

/** A game over Multi Internet: its packets can go over several internets. */
const isGameMultiProfile = computed(() => {
  const both = ProfileFlag.GAME_PACKET | ProfileFlag.MULTIPATH;
  return (props.profile.flags & both) === both;
});

const store = useStore();
const { profileLocked, profileUnavailable, canUpgrade, openUpgrade, admin, limits: planLimits } = usePlanAccess();

/** Admins only: when the profile last changed. */
const profileUpdatedText = computed(() => {
  if (!admin.value || !props.profile.updated_at) return "";
  const at = new Date(props.profile.updated_at);
  return Number.isNaN(at.getTime()) ? "" : t("$vuetify.consoleLog.profileUpdated", at.toLocaleString());
});
/** Every location it could use is locked by the plan: it still turns on
 * (split tunnelling, its internet and DNS rules), but its traffic goes
 * straight out, and a chip offers the plans that unlock a location. */
const direct = computed(() => profileLocked(props.profile.id));
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
/** Realtime optimization off (or the Basic route level, which has none):
 * routes never change on their own, so the card offers the fix itself. */
const realtimeOff = computed(
  () =>
    (!admin.value && planLimits.value?.max_hops === 1) ||
    settings.value.realtimeOptimization === false
);
const showFindBetterRoute = computed(() => realtimeOff.value && canFixLag.value);
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

const active = computed(() => store.isProfileActive(props.profile.id));

/** The description on one line; "more" shows when it is cut off. */
const descText = ref<HTMLElement | null>(null);
const descOpen = ref(false);
const descCut = ref(false);
useResizeObserver(descText, () => {
  const el = descText.value;
  if (el && !descOpen.value) descCut.value = el.scrollWidth > el.clientWidth + 1;
});
/** Region picking: the "Server" label goes with ProfileRegionSelection's button. */
const hasRegionSelection = computed(
  () =>
    props.profile.route_action == "route" &&
    (props.profile.flags & ProfileFlag.ALLOW_REGION_SELECTION) !== 0
);
/** The route diagram is opened with "Show route", remembered per profile,
 * and only while the profile is on (off, it has no route to show). */
const showRoute = useLocalStorage(`lz-profile-route-${props.profile.id}`, false);
const routeShown = computed(() => active.value && showRoute.value);

/** The featured card: the ping, a word on how it feels, and the route. */
const estimate = useProfileEstimate(props.profile.id);
/** The game's loss and bursts right now (the featured card shows them under
 * its ping), while there are any and the route is live. */
const linkNote = computed(() => {
  if (!props.featured || profileChart.value?.diagram?.idle) return null;
  const loss = profileChart.value?.link?.loss ?? 0;
  const burst = profileChart.value?.link?.burst ?? 0;
  if (loss <= 0 && burst <= 0) return null;
  const pct = (v: number) => localDigits(`${v < 10 ? v.toFixed(1) : Math.round(v)}%`);
  return { loss: loss > 0 ? pct(loss) : "", burst: burst > 0 ? pct(burst) : "", lossBad: loss >= 5, burstBad: burst >= 20 };
});
/** A ping to show: nothing measured yet (no traffic) shows nothing. */
const hasPing = computed(() => (estimate.value?.ping ?? 0) > 0);
const pingWord = computed(() => {
  const note = estimate.value?.note;
  if (note === "loss") return t("$vuetify.title.profile.health.loss");
  if (note === "lag") return t("$vuetify.title.profile.health.lag");
  return t("$vuetify.title.profile.health.steady");
});
const {
  internets: routeInternets,
  routeCount,
} = useRouteLine(props.profile.id);
/** Charts, the server strip and route settings: the featured card always,
 * the others in Advanced mode. */

/** Simple view: route settings open from the ⋮ menu, at its button. */
const settingsOpen = ref(false);
const regionOpen = ref(false);
const menuOpen = ref(false);
const quickOpen = ref(false);
const qualityOpen = ref(false);
// A title's right-click menu asked for its settings (or its location, when
// the page has no Play from): the game's card opens them.
const titleMenu = useTitleMenu();
onMounted(() => {
  // Bandwidth Control's "Through LagZap" asked for this profile's settings.
  if (titleMenu.takeProfile(props.profile.id, "settings")) {
    setTimeout(() => (settingsOpen.value = true), 150);
    return;
  }
  if (!props.featured) return;
  const id = props.profile.title_id;
  if (titleMenu.take(id, "settings")) setTimeout(() => (settingsOpen.value = true), 150);
  else if (hasRegionSelection.value && titleMenu.take(id, "location")) setTimeout(() => (regionOpen.value = true), 150);
});
const moreBtn = ref<{ $el: Element } | null>(null);

/** Simple view: what the profile does in plain words when it has no
 * description of its own (Advanced keeps the route settings summary). */
/** The title is a game (one of its profiles carries game packets): only
 * then do texts speak of "game". */
const gameTitle = computed(() =>
  store.profiles.some((p) => p.title_id === props.profile.title_id && (p.flags & ProfileFlag.GAME_PACKET) !== 0),
);
const plainDescription = computed(() => {
  if (hasProfileDescription.value) return profileDescription.value;
  if (isGameProfile.value) return t("$vuetify.title.profile.plain.game");
  if (isHighTrafficProfile.value) {
    return t(gameTitle.value ? "$vuetify.title.profile.plain.downloads" : "$vuetify.title.profile.plain.downloadsApp");
  }
  if ((props.profile.flags & ProfileFlag.BYPASS_SANCTIONS) !== 0) return t("$vuetify.title.profile.plain.access");
  return routeSettingsText.value;
});

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

/** A game's subtitle is its ping, then the data used while there is some
 * (ProfileActivityChip part="usage"). */
const gameUsageShown = computed(
  () =>
    store.isProfileActive(props.profile.id) &&
    store.appReady &&
    connected.value &&
    totalBytes.value > 0
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
    :class="{ 'profile-card--on': active, 'profile-card--single': single }"
    rounded="lg"
    variant="flat"
    density="comfortable"
    @mouseenter="changelogHover = true"
    @mouseleave="onProfileMouseLeave"
    @focusin="changelogHover = true"
    @focusout="onProfileFocusOut"
  >
    <!-- A title's only profile: the page's header names it already, so the
         card names its chart instead. -->
    <template #title>
      <div v-if="single" class="profile-card-title d-flex align-center ga-1">
        <span class="text-subtitle-1 profile-card-title__name">
          {{ t(gameTitle ? "$vuetify.title.profile.single.gameTitle" : "$vuetify.title.profile.single.title") }}
        </span>
        <ProfileCapButton v-if="isDownloadProfile && !unavailable" :profile-id="props.profile.id" :name="store.localized(props.profile.name)" />
      </div>
      <div v-else class="profile-card-title d-flex align-center ga-1">
        <span class="text-subtitle-1 profile-card-title__name">
          {{ store.localized(props.profile.name) }}
        </span>
        <!-- Launchers and downloads: their download cap, plan or not. -->
        <ProfileCapButton v-if="isDownloadProfile && !unavailable" :profile-id="props.profile.id" :name="store.localized(props.profile.name)" />
        <v-chip
          v-if="!active && !unavailable"
          size="x-small"
          class="profile-card__off"
          @click.stop="menuOpen = true"
        >
          {{ t("$vuetify.title.profile.statusOff") }}
        </v-chip>
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
      <div v-if="single" class="profile-card-desc">
        <span class="profile-card-desc__text">{{ t("$vuetify.title.profile.single.subtitle") }}</span>
      </div>
      <!-- What the profile does, in plain words (else its route settings). -->
      <!-- One line; a cut-off one ends in "more", which opens the rest. -->
      <div v-else class="profile-card-desc" :class="{ 'profile-card-desc--open': descOpen }">
        <span ref="descText" class="profile-card-desc__text">
          {{ plainDescription }}
        </span>
        <button
          v-if="descCut || descOpen"
          type="button"
          class="profile-card-desc__more"
          @click.stop="descOpen = !descOpen"
        >
          {{ t(descOpen ? "$vuetify.title.profile.showLess" : "$vuetify.title.profile.showMore") }}
        </button>
      </div>
    </template>

    <template #append>
      <AdminLogDialog
        v-if="admin"
        v-model="logOpen"
        kind="profile"
        :id="props.profile.id"
        :name="store.localized(props.profile.name)"
      />
      <DialogBugFeedback
        v-model="reportOpen"
        :subject="t('$vuetify.tickets.reportSubject', store.localized(props.profile.name))"
      />
      <!-- Not the game's card: its location, a quick pick on hover. The ⋮
           menu's Location opens the full selector. -->
      <v-scale-transition origin="center right">
        <span
          v-if="!featured && hasRegionSelection && !unavailable"
          v-show="changelogHover || quickOpen"
          class="me-1"
        >
          <QuickLocation
            :profile="props.profile"
            @more="regionOpen = true"
            @open="quickOpen = $event"
          />
        </span>
      </v-scale-transition>
      <!-- Every location locked: it goes direct; the chip offers the plans. -->
      <v-tooltip v-if="direct" location="bottom" max-width="300" :text="t('$vuetify.title.profile.directHint')">
        <template #activator="{ props: tipProps }">
          <v-chip
            v-bind="tipProps"
            size="small"
            color="amber"
            prepend-icon="mdi-lock-outline"
            class="me-1"
            :disabled="!canUpgrade"
            @click.stop="openUpgrade"
          >
            {{ t("$vuetify.title.profile.direct") }}
          </v-chip>
        </template>
      </v-tooltip>
      <!-- The featured card: the ping large, and how it feels (no server:
           no ping to show). -->
      <div v-if="active && featured && !direct && hasPing" class="profile-bigping">
        <ProfileEstimatedPing
          bare
          :profile-id="props.profile.id"
          :views="showInterfaceSelector && !smartRoutes ? interfaceSelectItems : []"
          :can-fix-lag="canFixLag"
          :fixing-lag="fixingLag"
          @fix-lag="fixLag"
          @show-latency="showLatency"
        >
        </ProfileEstimatedPing>
        <!-- Loss or bursts right now take this line; else how it feels,
             the routes and internets. -->
        <div
          v-if="linkNote"
          class="profile-bigping__word"
          :class="{ 'profile-bigping__word--link': !!profileChart?.link }"
          @click="profileChart?.link && (qualityOpen = true)"
        >
          <span v-if="linkNote.loss" :class="linkNote.lossBad ? 'text-error' : 'text-warning'">
            {{ t("$vuetify.networkLatency.loss") }} {{ linkNote.loss }}
          </span>
          <template v-if="linkNote.loss"> · {{ t("$vuetify.networkLatency.lossRecovered") }}</template>
          <template v-if="linkNote.loss && linkNote.burst"> · </template>
          <span v-if="linkNote.burst" :class="linkNote.burstBad ? 'text-error' : 'text-warning'">
            {{ t("$vuetify.networkLatency.burst") }} {{ linkNote.burst }}
          </span>
        </div>
        <div
          v-else-if="estimate"
          class="profile-bigping__word"
          :class="{ 'profile-bigping__word--link': !!profileChart?.link }"
          @click="profileChart?.link && (qualityOpen = true)"
        >
          {{ pingWord }}
          <template v-if="routeCount > 1">
            · {{ t("$vuetify.title.profile.subtitleRoutes", localDigits(routeCount)) }}
          </template>
          <template v-if="routeInternets">
            · {{ t("$vuetify.title.profile.internets", localDigits(routeInternets)) }}
          </template>
        </div>
      </div>
      <!-- On: its ping (Off is the chip by the name). -->
      <span v-else-if="active && hasPing && !direct" class="profile-status profile-status--on">
        <ProfileEstimatedPing
          bare
          :profile-id="props.profile.id"
          :views="showInterfaceSelector && !smartRoutes ? interfaceSelectItems : []"
          :can-fix-lag="canFixLag"
          :fixing-lag="fixingLag"
          @fix-lag="fixLag"
          @show-latency="showLatency"
        >
        </ProfileEstimatedPing>
      </span>
      <!-- Connection quality: a plain summary, every route's numbers under
           Show details. From ⋮ or the line under the ping. -->
      <LinkQualityIndicator v-if="profileChart?.link" v-model:open="qualityOpen" :link="profileChart.link" />
      <!-- This profile's own location (the full selector), opened from the
           ⋮ menu. -->
      <ProfileRegionSelection
        v-if="hasRegionSelection && !unavailable"
        v-model:open="regionOpen"
        bare
        :target="moreBtn?.$el ?? null"
        :profile="props.profile"
      />
      <!-- Its route settings, opened from the ⋮ menu. -->
      <ProfileRouteSettings
        v-if="!unavailable"
        v-model:open="settingsOpen"
        bare
        :target="moreBtn?.$el ?? null"
        :profile="props.profile"
      />
      <!-- The rarer actions: rate the session, report a problem, the
           admins' console. -->
      <!-- The data used: a green chip beside ⋮ (click: its traffic). -->
      <span
        v-if="active && !isGameProfile && (showProfileSections ? gameUsageShown : showUsageInSubtitle)"
        class="profile-usage me-1"
      >
        <ProfileActivityChip
          v-if="showProfileSections"
          :profile="props.profile"
          part="usage"
          clickable
          @click="showTraffic"
        />
        <ProfileActivityChip v-else :profile="props.profile" clickable @click="showTraffic" />
      </span>
      <v-menu v-model="menuOpen" location="bottom end">
        <template #activator="{ props: menuProps }">
          <v-btn
            v-bind="menuProps"
            ref="moreBtn"
            icon="mdi-dots-vertical"
            variant="text"
            size="small"
            color="on-surface"
            :aria-label="t('$vuetify.title.profile.moreActions')"
          />
        </template>
        <v-list density="compact" min-width="200">
          <!-- On or off (a title with one profile: the title's switch). -->
          <!-- The profile's own switch, a real one, the menu's first row. -->
          <v-list-item
            v-if="!single && !unavailable"
            class="profile-menu__switch"
            prepend-icon="mdi-power"
            :title="store.localized(props.profile.name)"
            :subtitle="t(active ? '$vuetify.title.profile.statusOnShort' : '$vuetify.title.profile.statusOff')"
            :disabled="!store.appReady"
            @click="toggleProfile(!active)"
          >
            <template #append>
              <v-switch
                :model-value="active"
                inset
                hide-details
                color="cyan"
                density="compact"
                class="profile-menu__switch-control"
                tabindex="-1"
                @click.stop.prevent="toggleProfile(!active)"
              />
            </template>
          </v-list-item>
          <v-divider v-if="!single && !unavailable" class="my-1" />
          <v-list-item
            v-if="hasRegionSelection && !unavailable"
            prepend-icon="mdi-map-marker-outline"
            :title="t('$vuetify.title.profile.location')"
            @click="regionOpen = true"
          />
          <v-list-item
            v-if="!unavailable"
            prepend-icon="mdi-cog-outline"
            :title="t('$vuetify.title.profile.settings')"
            @click="settingsOpen = true"
          />
          <v-list-item
            v-if="profileChart?.link"
            prepend-icon="mdi-chart-box-outline"
            :title="t('$vuetify.title.profile.link.title')"
            @click="qualityOpen = true"
          />
          <v-divider class="my-1" />
          <v-list-item
            v-if="canRate"
            prepend-icon="mdi-star-outline"
            :title="t('$vuetify.sessionRating.rateButton')"
            @click="rateProfile(props.profile.id, props.profile.title_id, t('$vuetify.sessionRating.noSession'))"
          />
          <v-list-item
            prepend-icon="mdi-bug-outline"
            :title="t('$vuetify.tickets.reportProblem')"
            @click="reportOpen = true"
          />
          <v-list-item
            v-if="admin"
            prepend-icon="mdi-console"
            :title="t('$vuetify.consoleLog.open')"
            :subtitle="profileUpdatedText || undefined"
            @click="logOpen = true"
          />
        </v-list>
      </v-menu>
    </template>

    <!-- Featured: You → servers → the game, each leg's ping; the data used
         and Details (the full diagram and connections) at the end. -->
    <!-- Only with a diagram to draw (multipath profiles): no empty gap. -->
    <div v-if="active && (featured || showProfileSections) && diagram?.show" class="profile-route">
      <RouteLine
        :profile="props.profile"
        :game-name="gameName"
        :game-icon="gameIcon"
        :expanded="showRoute"
        :hide-link="featured"
        toggleable
        @toggle="showRoute = !showRoute"
      />
      <!-- The fix button, when it is offered. -->
      <div v-if="showFindBetterRoute" class="profile-route__meta">
        <span class="profile-row__end">
          <v-btn
            v-if="showFindBetterRoute"
            prepend-icon="mdi-auto-fix"
            color="primary"
            variant="tonal"
            size="small"
            class="text-none"
            :loading="fixingLag"
            @click="fixLag"
          >
            {{ t("$vuetify.networkLatency.findBetterRoute") }}
          </v-btn>
        </span>
      </div>
    </div>


    <!-- Another internet helps: downloads go faster, games ride out one
         internet's lag. One line while the profile is in use. -->
    <!-- Dedicated IP (WireGuard) in use: which, its ping, and Disable. -->
    <div class="profile-hint-wrap">
      <WireGuardHint :profile-id="props.profile.id" />
    </div>
    <!-- A game on one route: multipath is off, above the hint. -->
    <div v-if="isGameMultiProfile" class="profile-hint-wrap">
      <MultipathOffHint :profile="props.profile" dismissable />
    </div>
    <!-- A game on one internet while another is clearly faster. -->
    <div v-if="isGameProfile" class="profile-hint-wrap">
      <BetterInternetHint :profile="props.profile" />
    </div>
    <MultiInternetHint
      v-if="isGameMultiProfile"
      kind="game"
      :profile-id="props.profile.id"
    />
    <MultiInternetHint
      v-else-if="isDownloadProfile"
      kind="download"
      :profile-id="props.profile.id"
      :compact="connected && downloadSpeed > 0"
    />

    <v-card-text
      v-if="active && (showProfileSections || isHighTrafficProfile || single)"
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
      </template>
      <!-- The profile's connections, folded away with one click (remembered):
           their toggle sits under the chart, beside the speeds; without a
           chart it stands on its own. -->
      <ProfilePingUsage :profile-id="props.profile.id" :divided="routeShown" :always="single" class="mb-2">
        <template v-if="routeShown && hasProfileConnections" #footer>
          <button type="button" class="profile-conns__toggle profile-conns__toggle--inline" @click="showConns = !showConns">
            {{ t("$vuetify.title.profile.connections") }}
            <span class="profile-conns__count">{{ localDigits(profileConnectionCount) }}</span>
            <v-icon :icon="showConns ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="16" />
          </button>
        </template>
      </ProfilePingUsage>
      <template v-if="routeShown && hasProfileConnections">
        <button v-if="!chartHasData" type="button" class="profile-conns__toggle" @click="showConns = !showConns">
          {{ t("$vuetify.title.profile.connections") }}
          <span class="profile-conns__count">{{ localDigits(profileConnectionCount) }}</span>
          <v-icon :icon="showConns ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="16" />
        </button>
        <v-expand-transition>
          <ProfileConnectionsTable v-if="showConns" :profile-id="props.profile.id" :limit="3" />
        </v-expand-transition>
      </template>
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

.profile-hint-wrap {
  padding: 0 0 12px;
}

/* Nothing to say: no empty gap. */
.profile-hint-wrap:not(:has(> *)) {
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

/* Its own card, a step lighter than the page's panel. */
.profile-card {
  transition: background-color 0.2s ease;
}


.profile-card.v-theme--light {
  background-color: rgb(var(--v-theme-background)) !important;
}

.profile-card-desc {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  font-size: 0.75rem;
  line-height: 1.4;
}

.profile-card-desc__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-card-desc--open {
  display: block;
}

.profile-card-desc--open .profile-card-desc__text {
  white-space: normal;
}

.profile-card-desc__more {
  flex-shrink: 0;
  margin-inline-start: 2px;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
}

/* Body parts line up with the name (past the switch). */
.profile-card .profile-hint-wrap {
  margin-inline: 16px;
}

.profile-row__end {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-inline-start: auto;
}

.profile-row__route {
  letter-spacing: normal;
}

.profile-conns__toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding: 2px 0;
  border: none;
  background: none;
  font: inherit;
  font-size: 0.8125rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
}

.profile-conns__toggle--inline {
  margin-bottom: 0;
  padding: 0;
  font-size: 0.75rem;
  line-height: 1;
}

.profile-conns__toggle:hover {
  color: rgb(var(--v-theme-on-surface));
}

.profile-conns__count {
  padding: 0 6px;
  border-radius: 999px;
  font-size: 0.6875rem;
  background: rgba(var(--v-theme-on-surface), 0.08);
}

/* The featured card's ping: large, a word under it. */
.profile-bigping {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  margin-inline-end: 4px;
}

.profile-bigping :deep(.est-ping) {
  align-items: center;
}

.profile-bigping :deep(.est-ping__dot) {
  display: none;
}

.profile-bigping :deep(.est-ping__value) {
  font-size: 1.75rem;
  font-weight: 500;
  line-height: 1.1;
}

.profile-bigping__word--link {
  cursor: pointer;
}

.profile-bigping__word--link:hover {
  text-decoration: underline dotted;
  text-underline-offset: 3px;
}

.profile-bigping__word {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* The route line: You → servers → the game, each leg's ping on its dash. */
.profile-route {
  margin: 22px 16px 30px;
}

.profile-route__meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  min-height: 32px;
  margin-top: 8px;
  font-size: 0.8125rem;
}

.profile-menu__switch {
  min-height: 56px !important;
}

.profile-menu__switch :deep(.v-list-item-title) {
  font-size: 0.9375rem;
  font-weight: 500;
}

.profile-menu__switch-control {
  margin-inline-start: 16px;
  flex: 0 0 auto;
}

.profile-usage {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  white-space: nowrap;
  background: rgba(var(--v-theme-success), 0.14);
  color: rgb(var(--v-theme-success));
}

.profile-usage :deep(*) {
  color: inherit !important;
}

.profile-card__off {
  cursor: pointer;
  letter-spacing: normal;
}

.profile-status--on :deep(.est-ping__dot) {
  display: none;
}

/* On · ping in green, or Off in grey, beside the gear. */
.profile-status {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  margin-inline-end: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  white-space: nowrap;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.profile-status--on {
  background: rgba(var(--v-theme-success), 0.15);
  color: rgb(var(--v-theme-success));
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

.profile-preview-note__title {
  text-transform: uppercase;
  letter-spacing: 0.04em;
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
