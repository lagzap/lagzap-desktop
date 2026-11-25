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
import PillToggle from "~/components/common/PillToggle.vue";
import {
  preferredTransportSetting,
  preferredTransportValue,
  type PreferredTransportSetting,
} from "~/composables/useSettings";
import ProfileDownloadCap from "~/components/title/ProfileDownloadCap.vue";
import MultipathOffHint from "~/components/title/MultipathOffHint.vue";
import { profileLimit } from "~/composables/useBandwidthControl";

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
}>();
const emit = defineEmits<{ pick: [id: string] }>();

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
const transportItems = computed(() => [
  (() => {
    const titles = fromTitle("preferred_transport");
    return titles !== null
      ? {
          value: "global" as TransportChoice,
          title: `${titleName.value} · ${transportName(preferredTransportSetting(titles))}`,
          icon: "mdi-link-variant",
        }
      : {
          value: "global" as TransportChoice,
          title: t("$vuetify.title.profile.followGlobal", transportName(settings.value.preferredTransport ?? "auto")),
          icon: "mdi-earth",
        };
  })(),
  { value: "auto" as TransportChoice, title: transportName("auto") },
  { value: "tcp" as TransportChoice, title: transportName("tcp") },
  { value: "udp" as TransportChoice, title: transportName("udp") },
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

const interfaces = computed(() => store.availableInterfaces);

const availableInterfaceNames = computed(() => store.availableInterfaceNames);
const selectedInterfaces = computed(
  () => state.value?.network_interfaces || []
);
const orphanedInterfaces = computed(() =>
  store.getUnavailableInterfaces(props.profile.id)
);

/** Available NICs plus orphans so missing adapters still show as closable chips. */
const interfaceSelectItems = computed(() => {
  const available = interfaces.value ?? [];
  const names = new Set(available.map((item) => item.Name));
  const extras = orphanedInterfaces.value
    .filter((name) => name && !names.has(name))
    .map((name) => ({ Name: name }));
  return [...available, ...extras];
});

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

const clearOrphanedInterfaces = async () => {
  await store.clearUnavailableInterfaces(props.profile.id);
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
      <v-card-title class="d-flex align-center ga-2">
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
            {{ store.localized(p.name) }}
          </v-chip>
        </v-chip-group>
        <span v-else>{{ titleScope ? String(store.localized(profile.name) || "") : t("$vuetify.title.profile.settings") }}</span>
      </v-card-title>

      <v-card-text>
        <!-- The title page's own options for this profile (Login connections). -->
        <slot name="top" />
        <v-row dense class="mt-2">
          <!-- Prevent disconnect: the transport its leg uses. -->
          <v-col v-if="preventOnly" cols="12">
            <div class="text-body-2 mb-1">{{ t("$vuetify.settings.route.preferredTransport") }}</div>
            <PillToggle v-model="preferredTransport" :items="transportItems" :disabled="!store.appReady" />
            <div class="text-caption text-medium-emphasis mt-1">{{ t("$vuetify.settings.route.preferredTransportHint") }}</div>
          </v-col>
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
                  <v-col cols="12">
                    <GlobalOverride
                      v-model="transportFallback"
                      :label="t('$vuetify.title.profile.transportFallback')"
                      :hint="t('$vuetify.title.profile.transportFallbackHint')"
                      :global="fromTitle('relay_transport_fallback') ?? !!settings.relayTransportFallback"
                      :follow-name="fromTitle('relay_transport_fallback') !== null ? titleName : undefined"
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
              <v-select
                v-model:model-value="
                  state.network_interfaces
                "
                :label="t('$vuetify.title.profile.multiInternet')"
                :hint="t('$vuetify.title.profile.networkAdaptersHint')"
                :placeholder="
                  t('$vuetify.title.profile.networkAdaptersPlaceholder')
                "
                :items="interfaceSelectItems"
                clearable
                item-value="Name"
                item-title="Name"
                variant="outlined"
                density="comfortable"
                multiple
                min-width="175"
                append-inner-icon="mdi-refresh"
                :disabled="!store.appReady"
                :loading="loadingInterfaces"
                :error-messages="orphanedInterfaces.length > 0 ? t('$vuetify.title.profile.unavailableInterfaces') : undefined"
                @click:append-inner="updateInterfaces"
              >
                <template #selection="{ item }">
                  <v-chip
                    :key="item.value"
                    rounded
                    closable
                    :color="availableInterfaceNames.includes(item.value) ? undefined : 'warning'"
                    @click:close="removeOrphanedInterface(item.value)"
                  >
                    {{ item.value }}
                  </v-chip>
                </template>
              </v-select>
              <div
                v-if="orphanedInterfaces.length > 0"
                class="d-flex align-center flex-wrap ga-2 mt-1 mb-2"
              >
                <v-btn
                  size="small"
                  variant="tonal"
                  color="warning"
                  :disabled="!store.appReady"
                  @click="clearOrphanedInterfaces"
                >
                  {{ t("$vuetify.title.profile.clearUnavailableInterfaces") }}
                </v-btn>
              </div>
            </template>
            <template
              v-else-if="(profile.flags & ProfileFlag.PREVENT_DISCONNECT) !== 0"
            >
              <v-select
                v-model:model-value="
                  state.default_interface
                "
                :label="t('$vuetify.title.profile.networkAdapter')"
                :hint="t('$vuetify.title.profile.networkAdaptersHint')"
                :placeholder="
                  t('$vuetify.title.profile.networkAdaptersPlaceholder')
                "
                :items="interfaceSelectItems"
                clearable
                item-value="Name"
                item-title="Name"
                variant="outlined"
                density="comfortable"
                class="mb-3"
                append-inner-icon="mdi-refresh"
                :disabled="!store.appReady"
                :loading="loadingInterfaces"
                :error-messages="orphanedInterfaces.length > 0 ? t('$vuetify.title.profile.unavailableInterface'): undefined"
                @click:append-inner="updateInterfaces"
              />
              <v-select
                v-model:model-value="
                  state.network_interfaces
                "
                :label="t('$vuetify.title.profile.backupInterfaces')"
                :hint="t('$vuetify.title.profile.backupInterfacesHint')"
                :placeholder="
                  t('$vuetify.title.profile.networkAdaptersPlaceholder')
                "
                :items="interfaceSelectItems"
                clearable
                item-value="Name"
                item-title="Name"
                variant="outlined"
                density="comfortable"
                multiple
                min-width="175"
                append-inner-icon="mdi-refresh"
                :disabled="!store.appReady"
                :loading="loadingInterfaces"
                :error-messages="orphanedInterfaces.length > 0 ? t('$vuetify.title.profile.unavailableInterfaces') : undefined"
                @click:append-inner="updateInterfaces"
              >
                <template #selection="{ item }">
                  <v-chip
                    :key="item.value"
                    rounded
                    closable
                    :color="availableInterfaceNames.includes(item.value) ? undefined : 'warning'"
                    @click:close="removeOrphanedInterface(item.value)"
                  >
                    {{ item.value }}
                  </v-chip>
                </template>
              </v-select>
              <div
                v-if="orphanedInterfaces.length > 0"
                class="d-flex align-center flex-wrap ga-2 mt-1 mb-2"
              >
                <v-btn
                  size="small"
                  variant="tonal"
                  color="warning"
                  :disabled="!store.appReady"
                  @click="clearOrphanedInterfaces"
                >
                  {{ t("$vuetify.title.profile.clearUnavailableInterfaces") }}
                </v-btn>
              </div>
            </template>
            <template v-else-if="(profile.flags & ProfileFlag.GAME_PACKET) !== 0">
              <v-select
                v-model:model-value="
                  state.network_interfaces
                "
                :label="t('$vuetify.title.profile.multiInternet')"
                :hint="t('$vuetify.title.profile.networkAdaptersHint')"
                :placeholder="
                  t('$vuetify.title.profile.networkAdaptersPlaceholder')
                "
                :items="interfaceSelectItems"
                clearable
                item-value="Name"
                item-title="Name"
                variant="outlined"
                density="comfortable"
                multiple
                min-width="175"
                append-inner-icon="mdi-refresh"
                :disabled="!store.appReady"
                :loading="loadingInterfaces"
                :error-messages="orphanedInterfaces.length > 0 ? t('$vuetify.title.profile.unavailableInterfaces') : undefined"
                @click:append-inner="updateInterfaces"
              >
                <template #selection="{ item }">
                  <v-chip
                    :key="item.value"
                    rounded
                    closable
                    :color="availableInterfaceNames.includes(item.value) ? undefined : 'warning'"
                    @click:close="removeOrphanedInterface(item.value)"
                  >
                    {{ item.value }}
                  </v-chip>
                </template>
              </v-select>
              <div
                v-if="orphanedInterfaces.length > 0"
                class="d-flex align-center flex-wrap ga-2 mt-1 mb-2"
              >
                <v-btn
                  size="small"
                  variant="tonal"
                  color="warning"
                  :disabled="!store.appReady"
                  @click="clearOrphanedInterfaces"
                >
                  {{ t("$vuetify.title.profile.clearUnavailableInterfaces") }}
                </v-btn>
              </div>
            </template>
          </v-col>
          <v-col
            v-else-if="profile.route_action != 'block' && !hideAdapter"
            cols="12"
          >
            <v-select
              v-model:model-value="
                state.default_interface
              "
              :label="t('$vuetify.title.profile.networkAdapter')"
              :hint="t('$vuetify.title.profile.networkAdaptersHint')"
              :placeholder="
                t('$vuetify.title.profile.networkAdaptersPlaceholder')
              "
              :items="interfaceSelectItems"
              append-inner-icon="mdi-refresh"
              clearable
              item-value="Name"
              item-title="Name"
              variant="outlined"
              density="comfortable"
              :disabled="!store.appReady"
              :loading="loadingInterfaces"
              :error-messages="orphanedInterfaces.length > 0 ? t('$vuetify.title.profile.unavailableInterface'): undefined"
              @click:append-inner="updateInterfaces"
            />
            <div
              v-if="orphanedInterfaces.length > 0"
              class="d-flex align-center flex-wrap ga-2 mt-1"
            >
              <v-btn
                size="small"
                variant="tonal"
                color="warning"
                :disabled="!store.appReady"
                @click="clearOrphanedInterfaces"
              >
                {{ t("$vuetify.title.profile.clearUnavailableInterfaces") }}
              </v-btn>
            </div>
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
.route-settings__profiles {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
