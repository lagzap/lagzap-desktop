<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useStore } from "@/stores";
import { useLocale } from "vuetify";
import { FindAvailableInterfaces } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import { ProfileFlag } from "~/constants/profile";
import { debounce } from "es-toolkit";
import {
  MAX_ROUTES,
  DEFAULT_TCP_ROUTES,
  DEFAULT_UDP_ROUTES,
  normalizeRouteCounts,
  resolveProfileRouteCounts,
} from "~/composables/routeCountUtils";
import { useNetworkAdapterSettings } from "~/composables/useNetworkAdapterSettings";

const props = defineProps<{
  profile: Profile;
}>();

const locale = useLocale();
const { t } = locale;
const store = useStore();

const {
  resolvedGlobalTcp,
  resolvedGlobalUdp,
  ensureLoaded: ensureNetworkSettingsLoaded,
} = useNetworkAdapterSettings();

const defaultTcpRoutes = resolvedGlobalTcp;
const defaultUdpRoutes = resolvedGlobalUdp;

const showAdvancedRouteOptions = ref(false);

const profileUsesCustomRoutes = computed(() => {
  const state = store.profileStates[props.profile.id];
  return (
    state?.route_connections != null ||
    state?.tcp_connections != null ||
    state?.udp_connections != null
  );
});

/** Simple mode: persist unified cap; coordinator allocates TCP/UDP. */
function applySimpleRouteCap(total: number | null) {
  const state = store.profileStates[props.profile.id];
  if (!state) return;

  delete state.tcp_connections;
  delete state.udp_connections;
  delete state.relay_transport_fallback;

  if (total === null) {
    delete state.route_connections;
    return;
  }

  state.route_connections = Math.max(
    1,
    Math.min(MAX_ROUTES, Math.round(total) || 1)
  );
}

const applyRouteCounts = (
  tcp: number | null,
  udp: number | null,
  changed: "tcp" | "udp",
) => {
  const state = store.profileStates[props.profile.id];
  if (!state) return;

  // Advanced explicit split replaces unified cap.
  delete state.route_connections;

  if (changed === "tcp" && tcp === null) {
    delete state.tcp_connections;
    return;
  }
  if (changed === "udp" && udp === null) {
    delete state.udp_connections;
    return;
  }

  const nextTcp = tcp ?? state.tcp_connections ?? defaultTcpRoutes.value;
  const nextUdp = udp ?? state.udp_connections ?? defaultUdpRoutes.value;
  const normalized = normalizeRouteCounts(nextTcp, nextUdp, changed);
  if (normalized.tcp !== null) {
    state.tcp_connections = normalized.tcp;
  } else {
    delete state.tcp_connections;
  }
  if (normalized.udp !== null) {
    state.udp_connections = normalized.udp;
  } else {
    delete state.udp_connections;
  }
};

const resolvedCounts = computed(() =>
  resolveProfileRouteCounts(store.profileStates[props.profile.id], {
    tcp: defaultTcpRoutes.value ?? DEFAULT_TCP_ROUTES,
    udp: defaultUdpRoutes.value ?? DEFAULT_UDP_ROUTES,
  })
);

/** Simple mode: one cap backed by route_connections. */
const totalRouteCap = computed({
  get: () => resolvedCounts.value.total,
  set: (value: number | null) => {
    applySimpleRouteCap(value);
  },
});

/** Always show effective counts (profile override or settings default). */
const tcpRoutes = computed({
  get: () => resolvedCounts.value.tcp,
  set: (value: number | null) => {
    if (value === null) {
      applyRouteCounts(null, store.profileStates[props.profile.id]?.udp_connections ?? null, "tcp");
      return;
    }
    const udp =
      store.profileStates[props.profile.id]?.udp_connections ??
      defaultUdpRoutes.value;
    applyRouteCounts(value, udp, "tcp");
  },
});

const udpRoutes = computed({
  get: () => resolvedCounts.value.udp,
  set: (value: number | null) => {
    if (value === null) {
      applyRouteCounts(store.profileStates[props.profile.id]?.tcp_connections ?? null, null, "udp");
      return;
    }
    const tcp =
      store.profileStates[props.profile.id]?.tcp_connections ??
      defaultTcpRoutes.value;
    applyRouteCounts(tcp, value, "udp");
  },
});

const resolvedTcpDisplay = computed(() => tcpRoutes.value);
const resolvedUdpDisplay = computed(() => udpRoutes.value);

const tcpRoutesMin = computed(() =>
  profileUsesCustomRoutes.value && udpRoutes.value === 0 ? 1 : 0,
);
const udpRoutesMin = computed(() =>
  profileUsesCustomRoutes.value && tcpRoutes.value === 0 ? 1 : 0,
);

const totalRoutes = computed(() => resolvedCounts.value.total);
const showMultiPathRouteWarnings = computed(() => totalRoutes.value <= 1);

function enterAdvancedRouteOptions() {
  showAdvancedRouteOptions.value = true;
}

function exitAdvancedRouteOptions() {
  applySimpleRouteCap(totalRoutes.value);
  showAdvancedRouteOptions.value = false;
}

function syncAdvancedRouteVisibility() {
  const state = store.profileStates[props.profile.id];
  // Explicit TCP/UDP split (no unified cap) → Advanced.
  showAdvancedRouteOptions.value =
    state?.route_connections == null &&
    (state?.tcp_connections != null || state?.udp_connections != null) &&
    (state?.tcp_connections ?? 0) > 0;
}

watch(
  () => props.profile.id,
  () => syncAdvancedRouteVisibility(),
  { immediate: true }
);

const transportFallbackMode = computed({
  get: () => {
    const value = store.profileStates[props.profile.id]?.relay_transport_fallback;
    if (value === undefined || value === null) {
      return "default";
    }
    return value ? "on" : "off";
  },
  set: (value: "default" | "on" | "off") => {
    const state = store.profileStates[props.profile.id];
    if (!state) return;
    if (value === "default") {
      delete state.relay_transport_fallback;
      return;
    }
    state.relay_transport_fallback = value === "on";
  },
});

const transportFallbackStateLabel = computed(() => {
  const key = {
    default: "transportFallbackDefault",
    on: "transportFallbackOn",
    off: "transportFallbackOff",
  }[transportFallbackMode.value];
  return t(`$vuetify.title.profile.${key}`);
});

const transportFallbackHintText = computed(
  () =>
    `${t("$vuetify.title.profile.transportFallbackHint")} · ${transportFallbackStateLabel.value}`,
);

function cycleTransportFallback() {
  const current = transportFallbackMode.value;
  transportFallbackMode.value =
    current === "default" ? "on" : current === "on" ? "off" : "default";
}

watch(
  store.profileStates,
  debounce(() => {
    store.saveProfileState(props.profile.id);
  }, 1000),
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

watch(
  () => store.interfaces,
  () => {
    store.updateProfileUnavailableInterfaces(props.profile.id);
  },
  { deep: true }
);

watch(
  () => store.latency,
  () => {
    store.updateProfileUnavailableInterfaces(props.profile.id);
  },
  { deep: true }
);

watch(
  () => store.availableInterfaceNames,
  () => {
    store.updateProfileUnavailableInterfaces(props.profile.id);
  },
  { deep: true }
);

const interfaces = computed(() => store.availableInterfaces);

const availableInterfaceNames = computed(() => store.availableInterfaceNames);
const selectedInterfaces = computed(
  () => store.profileStates[props.profile.id]?.network_interfaces || []
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
  const state = store.profileStates[props.profile.id];
  if (!state) {
    return;
  }
  const current = state.network_interfaces || [];
  state.network_interfaces = current.filter((name) => name !== interfaceName);
  if (state.default_interface === interfaceName) {
    state.default_interface = "";
  }
  store.updateProfileUnavailableInterfaces(props.profile.id);
  await store.saveProfileState(props.profile.id);
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

const dialogOpen = ref(false);
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
  >
    <template v-slot:activator="{ props }">
      <v-btn
        variant="plain"
        icon
        :text="t('$vuetify.title.advancedOptions')"
        color="default"
        v-bind="props"
      >
      <v-badge
        :model-value="orphanedInterfaces.length > 0"
        location="bottom left"
        color="warning"
        dot
      >
        <v-icon>mdi-cog</v-icon>
        </v-badge>
      </v-btn>
    </template>
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>{{ t("$vuetify.title.profile.routeSettings") }}</span>
      </v-card-title>

      <v-card-text>
        <v-row dense class="mt-2">
          <template
            v-if="
              (profile.flags & ProfileFlag.MULTIPATH) !== 0 &&
              profile.route_action == 'route'
            "
          >
            <v-col cols="12">
              <div class="d-flex align-center justify-space-between mb-1">
                <span class="text-body-2 text-medium-emphasis">
                  {{ t("$vuetify.title.profile.routes") }}
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
                  :max="MAX_ROUTES"
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
                      :max="MAX_ROUTES"
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
                      :max="MAX_ROUTES"
                      :disabled="!store.appReady"
                    />
                  </v-col>
                  <v-col cols="12">
                    <v-checkbox
                      :model-value="transportFallbackMode === 'on'"
                      :indeterminate="transportFallbackMode === 'default'"
                      :label="t('$vuetify.title.profile.transportFallback')"
                      :hint="transportFallbackHintText"
                      persistent-hint
                      hide-details="auto"
                      :disabled="!store.appReady"
                      @click.prevent="cycleTransportFallback"
                    />
                  </v-col>
                </v-row>
              </template>
            </v-col>
            <v-col cols="12">
              <v-scale-transition>
                <v-alert
                  v-if="showMultiPathRouteWarnings"
                  type="warning"
                  variant="tonal"
                  density="compact"
                  class="mb-2"
                >
                  <div class="text-subtitle-1 mb-1">
                    {{ t("$vuetify.title.profile.multiPathDisabled") }}
                  </div>
                  <div class="text-body-2 mb-2">
                    {{ t("$vuetify.title.profile.multiPathWarning") }}
                  </div>
                  <div class="text-body-2">
                    {{
                      t("$vuetify.title.profile.multiPathWarningRecommendation")
                    }}
                  </div>
                </v-alert>
              </v-scale-transition>
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
                  store.profileStates[profile.id].network_interfaces
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
                  store.profileStates[profile.id].default_interface
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
                  store.profileStates[profile.id].network_interfaces
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
                  store.profileStates[profile.id].network_interfaces
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
            v-else-if="profile.route_action != 'block'"
            cols="12"
          >
            <v-select
              v-model:model-value="
                store.profileStates[profile.id].default_interface
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

        <v-switch
          v-if="profile.route_action == 'route'"
          v-model:model-value="
            store.profileStates[profile.id].allow_local_routes
          "
          :label="t('$vuetify.title.profile.allowLocalRoutes')"
          :hint="t('$vuetify.title.profile.allowLocalRoutesHint')"
          density="comfortable"
          persistent-hint
          :disabled="!store.appReady"
        />
      </v-card-text>
    </v-card>
  </v-menu>
</template>
