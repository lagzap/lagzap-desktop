<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useStore } from "@/stores";
import { useLocale } from "vuetify";
import { FindAvailableInterfaces } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { Profile, ProfileState } from "~/bindings/github.com/lagzap/zap/data";
import { hasGroup, type RouteGroup } from "~/utils/profileRoute";
import { ProfileFlag } from "~/constants/profile";
import { debounce } from "es-toolkit";
import { MAX_ROUTES, normalizeRouteCounts } from "~/composables/routeCountUtils";
import { useProfileRouteCounts } from "~/composables/useProfileRouteCounts";
import { usePlanAccess } from "~/composables/usePlanAccess";
import PlanLock from "~/components/plan/PlanLock.vue";
import GlobalOverride from "~/components/common/GlobalOverride.vue";
import OverrideSetting from "~/components/common/OverrideSetting.vue";
import {
  preferredTransportSetting,
  preferredTransportValue,
  type PreferredTransportSetting,
} from "~/composables/useSettings";
import ProfileDownloadCap from "~/components/title/ProfileDownloadCap.vue";
import MultipathOffHint from "~/components/title/MultipathOffHint.vue";
import MultiInternetCard from "~/components/title/MultiInternetCard.vue";
import BackupInternetsCard from "~/components/title/BackupInternetsCard.vue";
import SingleInternetCard from "~/components/title/SingleInternetCard.vue";
import { profileLimit } from "~/composables/useBandwidthControl";
import { useRouteOverrides } from "~/composables/useRouteOverrides";

const props = defineProps<{
  profile: Profile;
  /** No gear of its own: opened through v-model:open, shown at target
   * (Simple view opens it from the card's ⋮ menu). */
  bare?: boolean;
  target?: Element | null;
  /** On the title page: the settings can be the whole title's too. */
  titleScope?: boolean;
  /** The title's profiles, as chips on top: picking one shows its
   * settings (emits pick). */
  profiles?: Profile[];
  /** The game's main profile on its page: its settings are the whole
   * game's (the title's), which its other profiles follow. */
  editsTitle?: boolean;
  /** Its internets are set above (load balancing): no Network Adapter here. */
  hideAdapter?: boolean;
  /** Of the chips, the game's main profile (its settings are the title's). */
  titleProfileId?: string;
}>();
const emit = defineEmits<{ pick: [id: string] }>();
const { profileOverrides, profileOverrideKinds, overridesText } = useRouteOverrides();

const locale = useLocale();
const { t } = locale;
const store = useStore();
const plan = usePlanAccess();

/** The settings are the profile's own; a setting it does not set follows
 * its title's (shown as "<title> · …"). */
const titleId = computed(() => props.profile.title_id ?? "");
const titleState = computed(() => store.titleStates[titleId.value]);
const titleName = computed(() => {
  const title = store.titles.find((x) => x.id === titleId.value);
  return title ? String(store.localized(title.name) || "") : "";
});
/** What the settings read and write: the profile's view (its own choices,
 * the title's where it has none). */
const state = computed<ProfileState>(
  () => (props.editsTitle ? titleState.value : store.profileStates[props.profile.id]) as ProfileState,
);
/** Only what the profile sets itself (not followed); the game's own for
 * its main profile. */
const own = computed<Partial<ProfileState> | undefined>(() =>
  props.editsTitle ? (titleState.value as Partial<ProfileState> | undefined) : store.ownProfileStates[props.profile.id],
);
/** A profile's value that follows the title: the title's, when it sets one. */
function fromTitle<K extends "allow_local_routes" | "relay_transport_fallback" | "preferred_transport">(k: K) {
  if (!props.titleScope || props.editsTitle) return null;
  const v = (titleState.value as Partial<ProfileState> | undefined)?.[k];
  return v === null || v === undefined ? null : v;
}
/** Groups Route Settings sets (the place is the picker's). */
const SETTING_GROUPS: RouteGroup[] = ["internet", "routes", "domestic", "fallback", "transport"];
// The main profile's own settings (from before) become the game's: what
// the page shows is what the game uses.
watch(
  () => (props.editsTitle ? props.profile.id : ""),
  async (id) => {
    if (id) await store.liftToTitle(id, SETTING_GROUPS);
  },
  { immediate: true },
);
/** Saves what the panel edits: the game's settings, or the profile's own. */
function saveEdited(id: string) {
  if (props.editsTitle && id === props.profile.id) return store.saveTitleState(titleId.value);
  return store.saveProfileState(id);
}
const {
  routeMax,
  ensureLoaded: ensureNetworkSettingsLoaded,
  profileUsesCustomRoutes,
  applySimpleRouteCap,
  resolvedCounts,
  tcpRoutes,
  udpRoutes,
  tcpRoutesMin,
  udpRoutesMin,
} = useProfileRouteCounts(
  () => props.profile.id,
  () => state.value,
);
const planRoutesCapped = computed(() => routeMax.value < MAX_ROUTES);

const showAdvancedRouteOptions = ref(false);

/** Simple mode: one cap backed by route_connections. */
const totalRouteCap = computed({
  get: () => resolvedCounts.value.total,
  set: (value: number | null) => {
    applySimpleRouteCap(value);
  },
});

const resolvedTcpDisplay = computed(() => tcpRoutes.value);
const resolvedUdpDisplay = computed(() => udpRoutes.value);

const totalRoutes = computed(() => resolvedCounts.value.total);


// Manual is saved as an explicit TCP/UDP split (no unified cap): picking it
// stores the split shown right away, so it is still Manual next time.
function enterAdvancedRouteOptions() {
  const st = state.value;
  if (st) {
    // Without the Smart cap the split is the profile's own counts or the
    // defaults: what Manual shows.
    const normalized = normalizeRouteCounts(tcpRoutes.value, udpRoutes.value, "tcp");
    st.route_connections = null;
    st.tcp_connections = normalized.tcp ?? 0;
    st.udp_connections = normalized.udp ?? 0;
  }
  showAdvancedRouteOptions.value = true;
}

function exitAdvancedRouteOptions() {
  applySimpleRouteCap(totalRoutes.value);
  showAdvancedRouteOptions.value = false;
}

function syncAdvancedRouteVisibility() {
  // Manual unless Smart was picked (a unified cap), as Go reads it: with no
  // counts of its own a profile uses the adapters' (1 TCP, 1 UDP by default).
  showAdvancedRouteOptions.value = state.value?.route_connections == null;
}

watch(
  () => props.profile.id,
  () => {
    syncAdvancedRouteVisibility();
  },
  { immediate: true }
);

const { settings } = useSettings();

// Settings with a global value: null follows it, true/false is this app's own.
// (A profile's null follows its title's, when the title sets one.)
const transportFallback = computed<boolean | null>({
  get: () => own.value?.relay_transport_fallback ?? null,
  set: (value) => {
    const st = own.value;
    if (st) st.relay_transport_fallback = value;
  },
});

/** Prevent disconnect (without Multi Internet): its one leg's transport,
 * Auto (the better one), TCP or UDP; "global" follows the setting on Route
 * Options. */
const preventOnly = computed(
  () =>
    (props.profile.flags & ProfileFlag.PREVENT_DISCONNECT) !== 0 &&
    (props.profile.flags & ProfileFlag.MULTIPATH) === 0 &&
    props.profile.route_action == "route",
);
type TransportChoice = "global" | PreferredTransportSetting;
const preferredTransport = computed<TransportChoice>({
  get: () => {
    const v = own.value?.preferred_transport;
    return v === undefined || v === null ? "global" : preferredTransportSetting(v);
  },
  set: (next) => {
    const st = own.value;
    if (st) st.preferred_transport = next === "global" ? null : preferredTransportValue(next);
  },
});
const transportName = (v: PreferredTransportSetting) => t(`$vuetify.settings.route.transport.${v}`);
/** The transport it follows: its game's, else the setting on Route Options. */
const followedTransport = computed<PreferredTransportSetting>(() => {
  const titles = fromTitle("preferred_transport");
  return titles !== null ? preferredTransportSetting(titles) : (settings.value.preferredTransport ?? "auto");
});
const transportItems = computed(() => [
  { value: "auto" as PreferredTransportSetting, title: transportName("auto") },
  { value: "tcp" as PreferredTransportSetting, title: transportName("tcp") },
  { value: "udp" as PreferredTransportSetting, title: transportName("udp") },
]);

const domesticRoutes = computed<boolean | null>({
  get: () => own.value?.allow_local_routes ?? null,
  set: (value) => {
    const st = own.value;
    if (st) st.allow_local_routes = value;
  },
});

/** Launchers and downloads (high traffic, not a game path) can be capped. */
const highTraffic = computed(() => {
  const flags = props.profile.flags ?? 0;
  return (
    (flags & ProfileFlag.HIGH_TRAFFIC) !== 0 &&
    (flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET | ProfileFlag.PREVENT_DISCONNECT)) === 0
  );
});

/** This app overrides a global setting: the settings button shows a dot. */
const hasCustomSettings = computed(
  () =>
    transportFallback.value !== null ||
    (props.profile.route_action == "route" && domesticRoutes.value !== null) ||
    (highTraffic.value && profileLimit(props.profile.id) !== null),
);

// Saved a moment after a change: the profile's own state, or the title's
// (its profiles then follow it). Switching to another profile's chip is no
// change; each profile changed is saved.
const unsaved = new Set<string>();
const saveChanged = debounce(() => {
  for (const id of unsaved) saveEdited(id);
  unsaved.clear();
}, 1000);
watch(
  () => ({ id: props.profile.id, st: own.value }),
  (next, prev) => {
    if (next.id !== prev?.id) return;
    unsaved.add(next.id);
    saveChanged();
  },
  { deep: true },
);
watch(
  () => store.profileStates[props.profile.id]?.network_interfaces,
  () => {
    store.updateProfileUnavailableInterfaces(props.profile.id);
  },
  { deep: true }
);

watch(
  () => store.profileStates[props.profile.id]?.default_interface,
  () => {
    store.updateProfileUnavailableInterfaces(props.profile.id);
  },
  { deep: true }
);

// Interfaces and latency only matter through the available names; a name key
// avoids deep-walking the twice-a-second latency payload per card.
watch(
  () => store.availableInterfaceNames.join("|"),
  () => {
    store.updateProfileUnavailableInterfaces(props.profile.id);
  }
);

const availableInterfaceNames = computed(() => store.availableInterfaceNames);
const selectedInterfaces = computed(
  () => state.value?.network_interfaces || []
);
const orphanedInterfaces = computed(() =>
  store.getUnavailableInterfaces(props.profile.id)
);

const removeOrphanedInterface = async (interfaceName: string) => {
  const st = state.value;
  if (!st) {
    return;
  }
  const current = st.network_interfaces || [];
  st.network_interfaces = current.filter((name) => name !== interfaceName);
  if (st.default_interface === interfaceName) {
    st.default_interface = "";
  }
  store.updateProfileUnavailableInterfaces(props.profile.id);
  await saveEdited(props.profile.id);
};

// Multi Internet following the settings (no internets of its own) keeps
// nothing of its own: a Default left from the old Network Adapter field (not
// shown on the card) is cleared, so the settings are what it reads.
watch(
  () => {
    const flags = props.profile.flags ?? 0;
    const multi = (flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET)) !== 0;
    const st = state.value;
    return multi && !!st && !(st.network_interfaces ?? []).some(Boolean) && !!st.default_interface;
  },
  (stale) => {
    if (stale) void followInternetSettings();
  },
  { immediate: true },
);

/** Its internets follow again: nothing of its own is kept (the profile
 * follows its game, the game the settings), so no dot and no primary. */
async function followInternetSettings() {
  if (props.editsTitle) {
    const st = own.value as Partial<ProfileState> | undefined;
    if (!st) return;
    st.default_interface = null as unknown as string;
    st.network_interfaces = [];
    return;
  }
  await store.followTitle(props.profile.id, ["internet"]);
}

/** Prevent disconnect's main internet and backups ("-" = none; both empty
 * follows the settings). */
const setPreventInternets = (main: string, backups: string[]) => {
  if (!main && backups.length === 0) return void followInternetSettings();
  if (!state.value) return;
  state.value.default_interface = main;
  state.value.network_interfaces = backups;
};

/** Multi Internet's picked internets; none follows the settings. */
const setNetworkInterfaces = (names: string[]) => {
  if (names.length === 0) return void followInternetSettings();
  if (state.value) state.value.network_interfaces = names;
};

/** The one internet; "" (the Default internet) follows the settings. */
const setDefaultInterface = (name: string) => {
  if (!name) return void followInternetSettings();
  if (state.value) state.value.default_interface = name;
};

const loadingInterfaces = ref(false);
const updateInterfaces = async () => {
  if (loadingInterfaces.value) return;
  loadingInterfaces.value = true;
  await FindAvailableInterfaces();
  loadingInterfaces.value = false;
};

const dialogOpen = defineModel<boolean>("open", { default: false });
const closeDialog = () => {
  dialogOpen.value = false;
};

// Initialize unavailable interfaces tracking
onMounted(async () => {
  await ensureNetworkSettingsLoaded();
  store.updateProfileUnavailableInterfaces(props.profile.id);
});
</script>

<template>
  <v-menu
    v-model="dialogOpen"
    min-width="350"
    width="400"
    max-width="500"
    scrollable
    :close-on-content-click="false"
    :target="bare ? target ?? undefined : undefined"
  >
    <template v-if="!bare" v-slot:activator="{ props }">
      <v-btn
        variant="plain"
        icon
        :text="t('$vuetify.title.advancedOptions')"
        color="default"
        v-bind="props"
      >
      <v-badge
        :model-value="orphanedInterfaces.length > 0 || hasCustomSettings"
        location="bottom left"
        :color="orphanedInterfaces.length > 0 ? 'warning' : 'primary'"
        dot
      >
        <v-tooltip
          activator="parent"
          :text="t('$vuetify.title.profile.customSettings')"
          :disabled="orphanedInterfaces.length > 0"
        />
        <v-icon>mdi-cog</v-icon>
        </v-badge>
      </v-btn>
    </template>
    <v-card>
      <v-card-title class="d-flex align-center justify-center ga-2">
        <!-- On the title page: whose settings these are, a chip each to
             switch between them. -->
        <v-chip-group
          v-if="profiles && profiles.length > 1"
          :model-value="profile.id"
          mandatory
          selected-class="text-primary"
          class="route-settings__profiles"
          @update:model-value="(id: unknown) => id && emit('pick', String(id))"
        >
          <v-chip v-for="p in profiles" :key="p.id" :value="p.id" variant="tonal" size="small">
            <!-- Its settings differ from the global ones. -->
            <span
              v-if="profileOverrides(p, p.id === titleProfileId)"
              v-tooltip="overridesText(profileOverrideKinds(p, p.id === titleProfileId))"
              class="override-dot me-1"
            />
            {{ store.localized(p.name) }}
          </v-chip>
        </v-chip-group>
        <span v-else>{{ titleScope ? String(store.localized(profile.name) || "") : t("$vuetify.title.profile.settings") }}</span>
      </v-card-title>

      <v-card-text>
        <!-- The title page's own options for this profile (Login connections). -->
        <slot name="top" />
        <v-row dense class="mt-2">
          <template
            v-if="
              (profile.flags & ProfileFlag.MULTIPATH) !== 0 &&
              profile.route_action == 'route'
            "
          >
            <v-col cols="12">
              <div class="d-flex align-center justify-space-between mb-1">
                <!-- TCP and UDP name themselves; the label is for the total only. -->
                <span class="text-body-2 text-medium-emphasis">
                  {{ showAdvancedRouteOptions ? "" : t("$vuetify.title.profile.smartRoutes") }}
                </span>
                <div class="d-flex align-center">
                  <v-btn
                    v-if="!showAdvancedRouteOptions"
                    variant="text"
                    size="small"
                    density="comfortable"
                    :disabled="!store.appReady"
                    @click="enterAdvancedRouteOptions"
                  >
                    {{ t("$vuetify.title.profile.routeOptionsAdvanced") }}
                  </v-btn>
                  <v-btn
                    v-else
                    variant="text"
                    size="small"
                    density="comfortable"
                    :disabled="!store.appReady"
                    @click="exitAdvancedRouteOptions"
                  >
                    {{ t("$vuetify.title.profile.routeOptionsSimple") }}
                  </v-btn>
                  <v-tooltip location="top" max-width="280">
                    <template #activator="{ props: tipProps }">
                      <v-btn
                        v-bind="tipProps"
                        icon
                        variant="text"
                        density="compact"
                        size="small"
                        :aria-label="t('$vuetify.title.profile.multiPathBandwidthInfo')"
                      >
                        <v-icon size="small">mdi-help-circle-outline</v-icon>
                      </v-btn>
                    </template>
                    <span>{{ t("$vuetify.title.profile.multiPathBandwidthInfo") }}</span>
                  </v-tooltip>
                </div>
              </div>

              <div v-if="planRoutesCapped" class="d-flex flex-wrap align-center ga-2 mb-2">
                <span v-if="planRoutesCapped" class="text-caption text-medium-emphasis">
                  {{ t("$vuetify.plan.routesLimit", routeMax) }}
                </span>
                <PlanLock v-if="planRoutesCapped" chip />
              </div>
              <template v-if="!showAdvancedRouteOptions">
                <v-number-input
                  v-model="totalRouteCap"
                  :base-color="profileUsesCustomRoutes ? 'primary' : undefined"
                  :color="profileUsesCustomRoutes ? 'primary' : undefined"
                  :hint="t('$vuetify.title.profile.routesHint')"
                  persistent-hint
                  variant="outlined"
                  density="comfortable"
                  control-variant="split"
                  inset
                  clearable
                  :min="1"
                  :max="routeMax"
                  :disabled="!store.appReady"
                  hide-details="auto"
                />
              </template>

              <template v-else>
                <v-row dense>
                  <v-col cols="6">
                    <v-number-input
                      :key="`tcp-${resolvedUdpDisplay}`"
                      v-model="tcpRoutes"
                      :base-color="profileUsesCustomRoutes ? 'primary' : undefined"
                      :color="profileUsesCustomRoutes ? 'primary' : undefined"
                      :label="t('$vuetify.title.profile.tcpRoutes')"
                      variant="outlined"
                      density="comfortable"
                      control-variant="split"
                      inset
                      clearable
                      :min="tcpRoutesMin"
                      :max="routeMax"
                      :disabled="!store.appReady"
                    />
                  </v-col>
                  <v-col cols="6">
                    <v-number-input
                      :key="`udp-${resolvedTcpDisplay}`"
                      v-model="udpRoutes"
                      :base-color="profileUsesCustomRoutes ? 'primary' : undefined"
                      :color="profileUsesCustomRoutes ? 'primary' : undefined"
                      :label="t('$vuetify.title.profile.udpRoutes')"
                      variant="outlined"
                      density="comfortable"
                      control-variant="split"
                      inset
                      clearable
                      :min="udpRoutesMin"
                      :max="routeMax"
                      :disabled="!store.appReady"
                    />
                  </v-col>
                </v-row>
              </template>
            </v-col>
            <v-col cols="12">
              <MultipathOffHint :profile="profile" class="mb-2" />
            </v-col>
          </template>
          <v-col
            v-if="
              ((profile.flags & ProfileFlag.MULTIPATH) !== 0 ||
                (profile.flags & ProfileFlag.GAME_PACKET) !== 0 ||
                (profile.flags & ProfileFlag.PREVENT_DISCONNECT) !== 0) &&
              profile.route_action == 'route'
            "
            cols="12"
          >
            <template v-if="(profile.flags & ProfileFlag.MULTIPATH) !== 0">
              <MultiInternetCard
                class="mb-2"
                :selected="state.network_interfaces || []"
                :adapters="availableInterfaceNames"
                :missing="orphanedInterfaces"
                :down="store.internetDownNames"
                :loading="loadingInterfaces"
                :disabled="!store.appReady"
                @change="setNetworkInterfaces"
                @remove="removeOrphanedInterface"
                @refresh="updateInterfaces"
              />
              <!-- Under its internets: a failed route tries the other transport. -->
              <GlobalOverride
                v-if="showAdvancedRouteOptions"
                v-model="transportFallback"
                class="mt-3"
                :label="t('$vuetify.title.profile.transportFallback')"
                icon="mdi-swap-horizontal"
                :hint="t('$vuetify.title.profile.transportFallbackHint')"
                :global="fromTitle('relay_transport_fallback') ?? !!settings.relayTransportFallback"
                :follow-name="fromTitle('relay_transport_fallback') !== null ? titleName : undefined"
                :disabled="!store.appReady"
              />
            </template>
            <template
              v-else-if="(profile.flags & ProfileFlag.PREVENT_DISCONNECT) !== 0"
            >
              <!-- Its main internet and backups, in order (or the settings'). -->
              <BackupInternetsCard
                class="mb-2"
                :main="state.default_interface || ''"
                :backups="state.network_interfaces || []"
                :adapters="availableInterfaceNames"
                :missing="orphanedInterfaces"
                :down="store.internetDownNames"
                :loading="loadingInterfaces"
                :disabled="!store.appReady"
                @change="setPreventInternets"
                @remove="removeOrphanedInterface"
                @refresh="updateInterfaces"
              />
              <!-- Under its internets: the transport its leg uses. -->
              <div
                v-if="preventOnly"
                class="mt-3"
              >
                <OverrideSetting
                  :label="t('$vuetify.settings.route.preferredTransport')"
                  icon="mdi-transit-connection-variant"
                  :hint="t('$vuetify.settings.route.preferredTransportHint')"
                  :items="transportItems"
                  :value="preferredTransport === 'global' ? followedTransport : preferredTransport"
                  :custom="preferredTransport !== 'global'"
                  :source="fromTitle('preferred_transport') !== null ? titleName : t('$vuetify.title.profile.followingGlobal')"
                  :source-icon="fromTitle('preferred_transport') !== null ? 'mdi-link-variant' : 'mdi-earth'"
                  :source-value="transportName(followedTransport)"
                  :disabled="!store.appReady"
                  @pick="(v: PreferredTransportSetting) => (preferredTransport = v)"
                  @reset="preferredTransport = 'global'"
                />
              </div>
            </template>
            <template v-else-if="(profile.flags & ProfileFlag.GAME_PACKET) !== 0">
              <MultiInternetCard
                class="mb-2"
                :selected="state.network_interfaces || []"
                :adapters="availableInterfaceNames"
                :missing="orphanedInterfaces"
                :down="store.internetDownNames"
                :loading="loadingInterfaces"
                :disabled="!store.appReady"
                @change="setNetworkInterfaces"
                @remove="removeOrphanedInterface"
                @refresh="updateInterfaces"
              />
            </template>
          </v-col>
          <v-col
            v-else-if="profile.route_action != 'block' && !hideAdapter"
            cols="12"
          >
            <!-- Its one internet: the Default internet, or one picked. -->
            <SingleInternetCard
              :selected="state.default_interface || ''"
              :adapters="availableInterfaceNames"
              :missing="orphanedInterfaces"
              :down="store.internetDownNames"
              :loading="loadingInterfaces"
              :disabled="!store.appReady"
              @change="setDefaultInterface"
              @refresh="updateInterfaces"
            />
          </v-col>
        </v-row>

        <ProfileDownloadCap
          v-if="highTraffic"
          class="mt-4"
          :profile-id="profile.id"
          :name="store.localized(profile.name)"
          :disabled="!store.appReady"
        />

        <GlobalOverride
          v-if="profile.route_action == 'route'"
          v-model="domesticRoutes"
          class="mt-4"
          :label="t('$vuetify.title.profile.allowLocalRoutes')"
          icon="mdi-home-import-outline"
          :hint="t('$vuetify.title.profile.allowLocalRoutesHint')"
          :global="fromTitle('allow_local_routes') ?? settings.allowLocalRoutes ?? true"
          :follow-name="fromTitle('allow_local_routes') !== null ? titleName : undefined"
          :disabled="!store.appReady"
        />

      </v-card-text>
    </v-card>
  </v-menu>
</template>

<style scoped>
/* A profile whose settings differ from the global ones: a small dot, in the
   text's own color. */
.override-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.75;
}
.route-settings__profiles {
  flex: 1 1 auto;
  min-width: 0;
}
/* The profiles' chips, centered over the settings. */
.route-settings__profiles :deep(.v-slide-group__content) {
  justify-content: center;
}
</style>
