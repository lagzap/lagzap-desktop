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
  normalizeRouteCounts,
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

const profileUsesCustomRoutes = computed(() => {
  const state = store.profileStates[props.profile.id];
  return state?.tcp_connections != null || state?.udp_connections != null;
});

const applyRouteCounts = (
  tcp: number | null,
  udp: number | null,
  changed: "tcp" | "udp",
) => {
  const state = store.profileStates[props.profile.id];
  if (!state) return;

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

/** Always show effective counts (profile override or settings default). */
const tcpRoutes = computed({
  get: () =>
    store.profileStates[props.profile.id]?.tcp_connections ??
    defaultTcpRoutes.value,
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
  get: () =>
    store.profileStates[props.profile.id]?.udp_connections ??
    defaultUdpRoutes.value,
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

const totalRoutes = computed(
  () => resolvedTcpDisplay.value + resolvedUdpDisplay.value,
);
const showMultiPathRouteWarnings = computed(() => totalRoutes.value <= 1);

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

const removeOrphanedInterface = (interfaceName: string) => {
  const current =
    store.profileStates[props.profile.id]?.network_interfaces || [];
  store.profileStates[props.profile.id].network_interfaces = current.filter(
    (name) => name !== interfaceName
  );
  store.updateProfileUnavailableInterfaces(props.profile.id);
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
            <v-col>
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
            <v-col>
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
              <v-alert
                v-if="!showMultiPathRouteWarnings"
                type="info"
                variant="tonal"
                density="compact"
                class="mb-2"
              >
                <div class="text-body-2">
                  {{ t("$vuetify.title.profile.multiPathBandwidthInfo") }}
                </div>
              </v-alert>
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
            <v-select
              v-if="(profile.flags & ProfileFlag.MULTIPATH) !== 0"
              v-model:model-value="
                store.profileStates[profile.id].network_interfaces
              "
              :label="t('$vuetify.title.profile.multiInternet')"
              :hint="t('$vuetify.title.profile.networkAdaptersHint')"
              :placeholder="
                t('$vuetify.title.profile.networkAdaptersPlaceholder')
              "
              :items="interfaces"
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
                  @click:close="
                    store.profileStates[profile.id].network_interfaces = (
                      store.profileStates[profile.id].network_interfaces || []
                    ).filter((name) => name !== item.value);
                    store.updateProfileUnavailableInterfaces(profile.id);
                  "
                >
                  {{ item.value }}
                </v-chip>
              </template>
            </v-select>
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
                :items="interfaces"
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
                :items="interfaces"
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
                    @click:close="
                      store.profileStates[profile.id].network_interfaces = (
                        store.profileStates[profile.id].network_interfaces || []
                      ).filter((name) => name !== item.value);
                      store.updateProfileUnavailableInterfaces(profile.id);
                    "
                  >
                    {{ item.value }}
                  </v-chip>
                </template>
              </v-select>
            </template>
            <v-select
              v-else-if="(profile.flags & ProfileFlag.GAME_PACKET) !== 0"
              v-model:model-value="
                store.profileStates[profile.id].network_interfaces
              "
              :label="t('$vuetify.title.profile.multiInternet')"
              :hint="t('$vuetify.title.profile.networkAdaptersHint')"
              :placeholder="
                t('$vuetify.title.profile.networkAdaptersPlaceholder')
              "
              :items="interfaces"
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
                  @click:close="
                    store.profileStates[profile.id].network_interfaces = (
                      store.profileStates[profile.id].network_interfaces || []
                    ).filter((name) => name !== item.value);
                    store.updateProfileUnavailableInterfaces(profile.id);
                  "
                >
                  {{ item.value }}
                </v-chip>
              </template>
            </v-select>
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
              :items="interfaces"
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
