<script setup lang="ts">
import { useDisplay } from "vuetify";
import QuickAccess from "./QuickAccess.vue";
import { Application, Events, Window } from "@wailsio/runtime";
import { useLocale } from "vuetify";
import { ConnectionStatus } from "~/bindings/github.com/lagzap/lagzap/adapter";
import { StopService } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import DiscordIcon from "~/components/icons/DiscordIcon.vue";
import XIcon from "~/components/icons/XIcon.vue";
import TelegramIcon from "~/components/icons/TelegramIcon.vue";
import LatencyChip from "~/components/network/LatencyChip.vue";

const { t } = useLocale();
const data = useSanctumUser<DataResponse>();
const { logout } = useSanctumAuth()
const user = computed(() => data.value.user);
const { planName, planStatusLabel } = useAccountStatus();
const planSubtitle = computed(
  () => `${planName.value} · ${planStatusLabel.value}`
);
const { mobile } = useDisplay();
const store = useStore();

const running = computed(() => store.ndisRunning);
const model = defineModel<boolean>({
  required: false,
  default: false,
});

async function onRoutingToggle(wantOn: boolean | null) {
  if (wantOn == null || wantOn === store.ndisRunning || store.ndisToggling) {
    return;
  }
  try {
    await store.setNDIS(wantOn);
  } catch (error) {
    console.warn("Routing toggle failed:", error);
  }
}

const showConnectedCheck = ref(false);
let connectedTimer: NodeJS.Timeout | null = null;

watch(() => store.connected, (newConnected, oldConnected) => {
  if (newConnected && !oldConnected) {
    showConnectedCheck.value = true;
    if (connectedTimer) {
      clearTimeout(connectedTimer);
    }
    connectedTimer = setTimeout(() => {
      showConnectedCheck.value = false;
    }, 1000);
  } else if (!newConnected) {
    showConnectedCheck.value = false;
    if (connectedTimer) {
      clearTimeout(connectedTimer);
      connectedTimer = null;
    }
  }
});

onUnmounted(() => {
  if (connectedTimer) {
    clearTimeout(connectedTimer);
  }
});

onActivated(async () => {
  Events.On("service-started", async () => {
    await store.startProxy();
  });

  if (store.serviceReady) {
    await store.startProxy();
  }
});

const quiting = ref(false)
const { checking: updateChecking, checkForUpdate } = useUpdateCheck(t)
const tickets = useTicketsStore()
const bugFeedbackOpen = ref(false)

async function exit() {
  quiting.value = true;
  await StopService();
  await Window.Close();
  await Application.Quit();
}
</script>

<template>
  <v-navigation-drawer
    v-model:model-value="model"
    :permanent="!mobile"
    :floating="!mobile"
    :color="mobile ? 'background' : 'transparent'"
  >
    <template #prepend>
      <v-menu width="300">
        <template v-slot:activator="{ props }">
          <v-list-item rounded="xl" height="56">
            <template #title>
              <NuxtLink :to="{ name: 'index' }" class="nav-home" :aria-label="t('$vuetify.navigation.overview')">
                <LogoName class="ms-3 me-1" />
              </NuxtLink>
            </template>
            <template #prepend>
              <span class="cursor-pointer" v-bind="props">
                <v-avatar rounded="circle" size="32">
                  <LagzapLogo />
                </v-avatar>
                <v-badge
                  :content="tickets.navBadgeCount"
                  :model-value="tickets.navBadgeCount > 0"
                  color="info"
                  floating
                  inline
                />
                <v-icon icon="mdi-chevron-down" size="xs" />
              </span>
            </template>

            <template #append>
              <v-scale-transition leave-absolute>
                <v-icon
                  v-if="!store.connected && store.status == ConnectionStatus.StatusReconnecting"
                  icon="mdi-loading"
                  color="primary"
                  size="20"
                  class="spin-composited me-2"
                />
                <v-icon
                  v-else-if="showConnectedCheck"
                  icon="mdi-check"
                  color="green"
                  size="20"
                  class="me-2"
                />
                <v-chip
                  v-else-if="!store.connected && store.appReady"
                  size="x-small"
                  color="orange"
                  variant="tonal"
                  class="me-2"
                >
                  {{ t("$vuetify.status.offline") }}
                </v-chip>
                <v-icon
                  v-else-if="!store.connected"
                  icon="mdi-lan-disconnect"
                  color="red"
                  size="20"
                  class="me-2"
                />
                <LatencyChip
                  v-else
                  :latency="store.latency"
                />
              </v-scale-transition>
            </template>
          </v-list-item>
        </template>
        <v-card>
          <v-list>
            <v-list-item
              v-if="user"
              :to="{ name: 'profile' }"
              :title="user.name ?? t('$vuetify.status.player1')"
              :subtitle="planSubtitle"
            >
              <template #prepend>
                <v-avatar
                  :variant="
                    (user.name || user.email)?.length
                      ? 'tonal'
                      : 'text'
                  "
                >
                  <span
                    v-if="(user.name || user.email)?.length"
                    class="text-xl text-uppercase"
                    >{{ (user.name || user.email)[0] }}</span
                  >
                  <v-icon v-else icon="mdi-account-circle" size="x-large" />
                </v-avatar>
              </template>

              <template #append>
                <v-tooltip
                  :text="
                    running
                      ? t('$vuetify.accountStatus.serviceRoutingHint')
                      : t('$vuetify.accountStatus.servicePausedHint')
                  "
                >
                  <template #activator="{ props: tipProps }">
                    <div v-bind="tipProps">
                      <v-switch
                        :model-value="running"
                        inset
                        hide-details
                        density="comfortable"
                        :color="store.error ? 'red' : 'green'"
                        :disabled="!store.serviceReady || store.loading || store.ndisToggling"
                        :loading="store.ndisToggling"
                        @update:model-value="onRoutingToggle"
                      />
                    </div>
                  </template>
                </v-tooltip>
              </template>
            </v-list-item>
          </v-list>
          <v-list density="compact">
            <v-divider />

            <v-list-item prepend-icon="mdi-cog" :to="{ name: 'settings' }">
              <template #title>
                <span class="text-caption">{{ t('$vuetify.navigation.settings') }}</span>
              </template>
            </v-list-item>
            <v-list-item
              prepend-icon="mdi-update"
              :disabled="updateChecking"
              @click="checkForUpdate"
            >
              <template #title>
                <span class="text-caption">{{ t('$vuetify.settings.checkForUpdate') }}</span>
              </template>
            </v-list-item>
            <v-list-item prepend-icon="mdi-bug" @click="bugFeedbackOpen = true">
              <template #title>
                <span class="text-caption">{{ t('$vuetify.tickets.bugFeedback') }}</span>
              </template>
            </v-list-item>
            <v-list-item @click="tickets.openTicketsPopup()">
              <template #prepend>
                <v-icon icon="mdi-lifebuoy" />
              </template>
              <template #title>
                <span class="text-caption">{{ t('$vuetify.tickets.helpCenter') }}</span>
              </template>
              <template #append>
                <v-badge
                  :content="tickets.navBadgeCount"
                  :model-value="tickets.navBadgeCount > 0"
                  color="info"
                  inline
                />
              </template>
            </v-list-item>
            <v-divider />
            
            <v-list-item prepend-icon="mdi-logout" @click="logout">
              <template #title>
                <span class="text-caption">{{ t('$vuetify.navigation.logout') }}</span>
              </template>
            </v-list-item>
            <v-list-item prepend-icon="mdi-close" @click="exit" :disabled="quiting">
              <template #title>
                <span class="text-caption">{{ t('$vuetify.navigation.exit') }}</span>
              </template>
            </v-list-item>
            <v-divider />
          </v-list>
          <div class="d-flex justify-center align-center gap-2 mb-2">
            <v-btn size="40" color="accent" variant="text" icon="mdi-instagram" />
            <v-btn size="40" color="accent" variant="text" :icon="XIcon" />
            <v-btn size="40" color="accent" variant="text" :icon="DiscordIcon" />
            <v-btn size="40" color="accent" variant="text" :icon="TelegramIcon" />
          </div>
        </v-card>
      </v-menu>
    </template>

    <v-list nav :lines="false" variant="text" color="tertiary">
      <v-list-item
        :to="{ name: 'titles' }"
        :title="t('$vuetify.navigation.titles')"
        prepend-icon="mdi-gamepad"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        v-if="false"
        :to="{ name: 'console' }"
        :title="t('$vuetify.navigation.gamingConsoles')"
        prepend-icon="mdi-controller"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        :to="{ name: 'monitoring' }"
        :title="t('$vuetify.navigation.monitoring')"
        prepend-icon="mdi-chart-line"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        :to="{ name: 'multi-internet' }"
        :title="t('$vuetify.navigation.multiInternet')"
        prepend-icon="mdi-call-split"
        rounded="xl"
        density="compact"
      />
      <v-list-item
        :to="{ name: 'connections' }"
        :title="t('$vuetify.navigation.connections')"
        prepend-icon="mdi-network-outline"
        rounded="xl"
        density="compact"
      />
    </v-list>

    <QuickAccess />

    <DialogBugFeedback v-model="bugFeedbackOpen" />
  </v-navigation-drawer>
</template>

<style scoped>
/* The LagZap name is the way to Overview. */
.nav-home {
  color: inherit;
  text-decoration: none;
  display: inline-flex;
}
</style>
