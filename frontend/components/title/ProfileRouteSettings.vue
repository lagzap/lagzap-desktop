<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useStore } from "@/stores";
import { useLocale } from "vuetify";
import { FindAvailableInterfaces } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import { ProfileFlag } from "~/constants/profile";
import { debounce } from "es-toolkit";

const props = defineProps<{
  profile: Profile;
}>();

const MAX_ROUTES = 4;

const locale = useLocale();
const { t } = locale;
const store = useStore();

const normalizeRouteCounts = (
  tcp: number,
  udp: number,
  changed: "tcp" | "udp"
): { tcp: number; udp: number } => {
  tcp = Math.max(0, Math.min(MAX_ROUTES, Math.round(tcp) || 0));
  udp = Math.max(0, Math.min(MAX_ROUTES, Math.round(udp) || 0));

  const excess = tcp + udp - MAX_ROUTES;
  if (excess > 0) {
    if (changed === "tcp") {
      udp = Math.max(0, udp - excess);
    } else {
      tcp = Math.max(0, tcp - excess);
    }
  }

  if (tcp + udp < 1) {
    if (changed === "tcp") {
      if (tcp === 0) {
        udp = 1;
      } else {
        tcp = 1;
      }
    } else if (udp === 0) {
      tcp = 1;
    } else {
      udp = 1;
    }
  }

  return { tcp, udp };
};

const applyRouteCounts = (tcp: number, udp: number, changed: "tcp" | "udp") => {
  const state = store.profileStates[props.profile.id];
  if (!state) return;
  const normalized = normalizeRouteCounts(tcp, udp, changed);
  state.tcp_connections = normalized.tcp;
  state.udp_connections = normalized.udp;
};

const tcpRoutes = computed({
  get: () => store.profileStates[props.profile.id]?.tcp_connections ?? 0,
  set: (value: number) => {
    const udp = store.profileStates[props.profile.id]?.udp_connections ?? 0;
    applyRouteCounts(value, udp, "tcp");
  },
});

const udpRoutes = computed({
  get: () => store.profileStates[props.profile.id]?.udp_connections ?? 0,
  set: (value: number) => {
    const tcp = store.profileStates[props.profile.id]?.tcp_connections ?? 0;
    applyRouteCounts(tcp, value, "udp");
  },
});

const tcpRoutesMin = computed(() => (udpRoutes.value === 0 ? 1 : 0));
const udpRoutesMin = computed(() => (tcpRoutes.value === 0 ? 1 : 0));

const totalRoutes = computed(() => tcpRoutes.value + udpRoutes.value);
const showMultiPathRouteWarnings = computed(() => totalRoutes.value <= 1);

watch(
  store.profileStates,
  debounce((newState) => {
    console.log(newState, props.profile.id)
    store.saveProfileState(props.profile.id);
  }, 1000),
  { deep: true }
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

const interfaces = computed(() => store.interfaces);

const availableInterfaceNames = computed(() =>
  interfaces.value.map((iface) => iface.Name)
);
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
onMounted(() => {
  const state = store.profileStates[props.profile.id];
  if (state) {
    applyRouteCounts(
      state.tcp_connections ?? 0,
      state.udp_connections ?? 0,
      "udp"
    );
  }
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
                :key="`tcp-${udpRoutes}`"
                v-model:model-value="tcpRoutes"
                :label="t('$vuetify.title.profile.tcpRoutes')"
                variant="outlined"
                density="comfortable"
                control-variant="split"
                inset
                :min="tcpRoutesMin"
                :max="MAX_ROUTES"
                :disabled="!store.appReady"
              />
            </v-col>
            <v-col>
              <v-number-input
                :key="`udp-${tcpRoutes}`"
                v-model:model-value="udpRoutes"
                :label="t('$vuetify.title.profile.udpRoutes')"
                variant="outlined"
                density="comfortable"
                control-variant="split"
                inset
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
            </v-col>
          </template>
          <v-col
            v-if="
              (profile.flags & ProfileFlag.GAME_PACKET) !== 0 &&
              profile.route_action == 'route'
            "
            cols="12"
          >
            <v-select
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
          <v-col v-else-if="profile.route_action != 'block'" cols="12">
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
