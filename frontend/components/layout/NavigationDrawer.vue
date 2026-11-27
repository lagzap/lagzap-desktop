<script setup lang="ts">
import { useDisplay } from "vuetify";
import QuickAccess from "./QuickAccess.vue";
import { Events } from "@wailsio/runtime";
import { useLocale } from "vuetify";
import { QuitApp, RestartApp } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import DiscordIcon from "~/components/icons/DiscordIcon.vue";
import XIcon from "~/components/icons/XIcon.vue";
import TelegramIcon from "~/components/icons/TelegramIcon.vue";
import LatencyChip from "~/components/network/LatencyChip.vue";
import TitleIcon from "~/components/title/TitleIcon.vue";
import { formatSpeed, localDigits } from "~/utils/localeFormat";
import { useLocalStorage } from "@vueuse/core";
import { useMonitoringStore } from "~/stores/monitoring";
import { activeLimitCount, totalDownloadSpeed, watchBandwidth } from "~/composables/useBandwidthControl";
import { openAdminTools } from "~/composables/useAdminToolsWindow";

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

const { paused, resume } = useLagzapPaused();
// Bandwidth Control hovered, or its speed pinned (right-click): the speed
// streams (as on its page) and shows. Pinned is kept on this PC.
const bandwidthHover = ref(false);
const speedPinned = useLocalStorage("lz-nav-speed-pinned", false);
const bandwidthHovered = computed(() => bandwidthHover.value || speedPinned.value);
let speedStreaming = false;
watchEffect(() => {
  const on = bandwidthHovered.value;
  if (on !== speedStreaming) {
    speedStreaming = on;
    watchBandwidth(on);
  }
});
onBeforeUnmount(() => {
  if (speedStreaming) watchBandwidth(false);
  speedStreaming = false;
});
function setBandwidthHovered(on: boolean) {
  bandwidthHover.value = on;
}
function toggleSpeedPinned(event: MouseEvent) {
  event.preventDefault();
  speedPinned.value = !speedPinned.value;
}
async function onRoutingToggle(wantOn: boolean | null) {
  if (wantOn == null || wantOn === store.ndisRunning || store.ndisToggling) return;
  try {
    await store.setNDIS(wantOn);
  } catch (error) {
    console.warn("Routing toggle failed:", error);
  }
}

// Counts beside the menu items: the game connections (the same ones the
// Connections page lists) and the internets when there is more than one.
const { connections } = useMonitoringStore();
const connectionCount = computed(
  () => connections.value?.filter((c) => !!c.profile_id).length ?? 0
);
/** The titles with the most connections, for the Connections item: the top
 * two as overlapping icons, then the number of connections left. */
const connectionTitles = computed(() => {
  const byTitle = new Map<string, number>();
  for (const c of connections.value ?? []) {
    if (!c.profile_id || !c.title_id) continue;
    byTitle.set(c.title_id, (byTitle.get(c.title_id) ?? 0) + 1);
  }
  const ranked = [...byTitle.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ title: store.titles.find((t) => t.id === id), count }))
    .filter((x) => !!x.title);
  const top = ranked.slice(0, 2);
  const shown = top.reduce((n, x) => n + x.count, 0);
  return { top, left: ranked.length > 2 ? connectionCount.value - shown : 0 };
});
const internetCount = computed(
  () => store.interfaces.filter((iface) => !!iface.Name).length
);
const model = defineModel<boolean>({
  required: false,
  default: false,
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
function toggleHelpCenter() {
  if (tickets.popupOpen) tickets.minimizeTicketPopup()
  else if (tickets.popupVisible) tickets.expandTicketPopup()
  else tickets.openTicketsPopup()
}
// The open chat's subject, or Help Center on the list.
const helpTitle = computed(() =>
  (tickets.popupShowingChat && tickets.activeTicket?.subject) || t('$vuetify.tickets.helpCenter')
)
// Admin accounts get Admin Tools here on every build, production included.
const { admin: isAdmin } = usePlanAccess()

// Exit asks first (Cancel is the default), and can restart instead. Both
// quit like the tray's Quit; before, Exit only hid the window to the tray.
const exitDialog = ref(false);
const exitCancelBtn = ref<{ $el?: HTMLElement } | null>(null);
function exit() {
  exitDialog.value = true;
}
async function confirmExit(restart: boolean) {
  quiting.value = true;
  try {
    if (restart) await RestartApp();
    else await QuitApp();
  } catch (error) {
    console.warn("Exit failed:", error);
    quiting.value = false;
  }
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
            <!-- The name opens the same menu as the logo (Dashboard is in the
                 list below). -->
            <template #title>
              <span class="nav-home cursor-pointer" v-bind="props">
                <LogoName class="ms-3 me-1" />
              </span>
            </template>
            <template #prepend>
              <span class="cursor-pointer" v-bind="props">
                <v-avatar rounded="circle" size="40">
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
              <!-- LagZap's main switch: running, or paused (everything goes
                   direct). -->
              <v-switch
                v-tooltip:bottom="t(store.ndisRunning ? '$vuetify.accountStatus.running' : '$vuetify.accountStatus.paused')"
                :model-value="store.ndisRunning"
                hide-details
                density="compact"
                :color="store.error ? 'red' : 'green'"
                :disabled="!store.serviceReady || store.loading || store.ndisToggling"
                :loading="store.ndisToggling"
                :aria-label="t(store.ndisRunning ? '$vuetify.accountStatus.running' : '$vuetify.accountStatus.paused')"
                class="nav-main-switch flex-grow-0"
                @update:model-value="onRoutingToggle"
              />
            </template>
          </v-list-item>
        </template>
        <v-card>
          <v-list class="py-1">
            <v-list-item
              v-if="user"
              :to="{ name: 'profile' }"
              :title="user.name ?? t('$vuetify.status.player1')"
              :subtitle="planSubtitle"
            >
              <template #prepend>
                <v-avatar
                  :variant="
                    user.name?.length
                      ? 'tonal'
                      : 'text'
                  "
                >
                  <span
                    v-if="user.name?.length"
                    class="text-xl text-uppercase"
                    >{{ user.name[0] }}</span
                  >
                  <v-icon v-else icon="mdi-account-circle" size="x-large" />
                </v-avatar>
              </template>

              <!-- Opens the account page; the chevron turns with the
                   language direction (style.scss). -->
              <template #append>
                <v-icon icon="mdi-chevron-right" size="20" class="text-medium-emphasis" />
              </template>
            </v-list-item>
          </v-list>
          <v-list density="compact" class="py-1">
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
            <v-list-item v-if="isAdmin" prepend-icon="mdi-tools" @click="openAdminTools()">
              <template #title>
                <span class="text-caption">Admin Tools</span>
              </template>
            </v-list-item>
            <v-list-item prepend-icon="mdi-bug" @click="bugFeedbackOpen = true">
              <template #title>
                <span class="text-caption">{{ t('$vuetify.tickets.bugFeedback') }}</span>
              </template>
            </v-list-item>
            <v-list-item @click="tickets.openTicketsPopup()">
              <template #prepend>
                <v-icon icon="mdi-chat" />
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
      <!-- LagZap paused: said on every page, with Resume. -->
      <v-expand-transition>
        <div v-if="paused" class="nav-paused">
          <v-icon icon="mdi-pause-circle-outline" size="18" color="warning" />
          <span class="flex-grow-1 text-truncate">{{ t("$vuetify.accountStatus.paused") }}</span>
          <v-btn size="x-small" variant="tonal" color="warning" @click="resume">{{ t("$vuetify.status.resume") }}</v-btn>
        </div>
      </v-expand-transition>
    </template>

    <v-list nav :lines="false" variant="text" color="tertiary">
      <v-list-item
        :to="{ name: 'index' }"
        exact
        :title="t('$vuetify.navigation.dashboard')"
        prepend-icon="mdi-view-dashboard-outline"
        rounded="xl"
        density="compact"
      />
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
      >
        <!-- The internet's ping now: its clicks open its popup and nothing
             else. The chip's menu stops a click from bubbling, but the click
             still followed the item's link (prevented here, before the chip,
             in the capture phase): on the Internet Status page that fired a
             same-page navigation, and the menu closes on navigation. -->
        <template #append>
          <span
            class="nav-ping"
            @pointerdown.stop
            @mousedown.stop
            @pointerup.stop
            @mouseup.stop
            @click.capture.prevent
            @keydown.enter.stop
            @keydown.space.stop
          >
            <LatencyChip :latency="store.latency" />
          </span>
        </template>
      </v-list-item>
      <v-list-item
        :to="{ name: 'bandwidth-control' }"
        :title="t('$vuetify.navigation.bandwidthControl')"
        prepend-icon="mdi-speedometer"
        rounded="xl"
        density="compact"
        @mouseenter="setBandwidthHovered(true)"
        @mouseleave="setBandwidthHovered(false)"
        @contextmenu="toggleSpeedPinned"
      >
        <!-- Hovered or pinned (right-click): every internet's download
             now (the page's "All internets"); else how many caps apply. -->
        <template v-if="bandwidthHovered || activeLimitCount > 0" #append>
          <span v-if="bandwidthHovered" class="nav-count nav-speed">
            <v-icon icon="mdi-arrow-down" size="12" />{{ formatSpeed(totalDownloadSpeed) }}
          </span>
          <span v-else class="nav-count">{{ localDigits(activeLimitCount) }}</span>
        </template>
      </v-list-item>
      <v-list-item
        :to="{ name: 'multi-internet' }"
        :title="t('$vuetify.navigation.multiInternet')"
        prepend-icon="mdi-call-split"
        rounded="xl"
        density="compact"
      >
        <template v-if="internetCount > 1" #append>
          <!-- How many internets: shown only while the item is hovered. -->
          <span class="nav-count nav-count--hover">{{ localDigits(internetCount) }}</span>
        </template>
      </v-list-item>
      <v-list-item
        :to="{ name: 'connections' }"
        :title="t('$vuetify.navigation.connections')"
        prepend-icon="mdi-network-outline"
        rounded="xl"
        density="compact"
      >
        <template v-if="connectionCount > 0" #append>
          <!-- The busiest titles' icons, overlapping; the rest as "+n". -->
          <span v-if="connectionTitles.top.length" class="nav-titles">
            <span v-for="x in connectionTitles.top" :key="x.title?.id" class="nav-titles__icon">
              <TitleIcon :image="x.title?.icon_url" :size="22" rounded="circle" />
            </span>
            <span v-if="connectionTitles.left > 0" class="nav-titles__more">
              +{{ localDigits(connectionTitles.left) }}
            </span>
          </span>
          <span v-else class="nav-count">{{ localDigits(connectionCount) }}</span>
        </template>
      </v-list-item>
    </v-list>

    <QuickAccess />

    <!-- While the Help Center is in use, or support has written something
         unread, a shortcut to it sits at the bottom of the drawer (where no
         page's floating button can cover it): it opens the popup, hides it,
         or brings it back on its chat. Closing the popup with its X removes
         it once nothing is unread; the logo menu always opens it. -->
    <template v-if="tickets.popupVisible || tickets.navBadgeCount > 0" #append>
      <v-list nav :lines="false" variant="text" color="tertiary" class="pt-0">
        <v-divider class="mb-1" />
        <v-list-item
          class="nav-help"
          :title="helpTitle"
          prepend-icon="mdi-chat"
          rounded="xl"
          density="compact"
          :active="tickets.popupOpen"
          @click="toggleHelpCenter"
        >
          <template v-if="tickets.navBadgeCount > 0" #append>
            <v-badge :content="tickets.navBadgeCount" color="info" inline />
          </template>
        </v-list-item>
      </v-list>
    </template>

    <DialogBugFeedback v-model="bugFeedbackOpen" />

    <v-dialog v-model="exitDialog" max-width="400" @after-enter="exitCancelBtn?.$el?.focus()">
      <v-card rounded="xl">
        <v-card-item>
          <template #prepend>
            <v-avatar color="error" variant="tonal" icon="mdi-power" />
          </template>
          <v-card-title class="text-wrap">{{ t("$vuetify.navigation.exitConfirm.title") }}</v-card-title>
        </v-card-item>
        <v-card-text class="text-body-2 text-medium-emphasis">
          {{ t("$vuetify.navigation.exitConfirm.text") }}
        </v-card-text>
        <v-card-actions>
          <v-btn
            variant="text"
            prepend-icon="mdi-restart"
            :disabled="quiting"
            @click="confirmExit(true)"
          >
            {{ t("$vuetify.navigation.exitConfirm.restart") }}
          </v-btn>
          <v-spacer />
          <v-btn ref="exitCancelBtn" variant="tonal" :disabled="quiting" @click="exitDialog = false">
            {{ t("$vuetify.navigation.exitConfirm.cancel") }}
          </v-btn>
          <v-btn color="error" variant="text" :loading="quiting" @click="confirmExit(false)">
            {{ t("$vuetify.navigation.exit") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-navigation-drawer>
</template>

<style scoped>
/* The LagZap name is the way to Overview. */
/* A count as plain text after the item, not a filled badge; centred in
   the same 36px column as the apps' dots, chips and locks below. */
.nav-count--hover {
  opacity: 0;
  transition: opacity 120ms ease;
}

.v-list-item:hover .nav-count--hover,
.v-list-item:focus-visible .nav-count--hover {
  opacity: 1;
}

.nav-speed {
  align-items: center;
  gap: 2px;
  white-space: nowrap;
}

.nav-count {
  display: inline-flex;
  justify-content: center;
  min-width: 36px;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* LagZap paused: a strip under the logo (amber tint, plain text). */
.nav-paused {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 12px 8px;
  padding: 6px 8px 6px 10px;
  border-radius: 10px;
  background: rgba(var(--v-theme-warning), 0.14);
  font-size: 0.8125rem;
}

/* The ping chip (26px) sits in the item's 32px row without growing it. */
.nav-ping {
  display: inline-flex;
  align-items: center;
  margin-block: -6px;
}

/* The main switch beside the logo: small, no row height of its own. */
.nav-main-switch {
  flex: none;
  /* Its knob reaches past the control: room so the sidebar's edge never
     cuts it (right to left, it sits by that edge). */
  padding-inline: 6px;
}

.nav-main-switch :deep(.v-selection-control) {
  min-height: 0;
}

.nav-home {
  color: inherit;
  text-decoration: none;
  display: inline-flex;
}

/* Connections: the busiest titles' icons, overlapping like avatars. Each
   is a 22px circle; where the next one overlaps it, a 2px gap is cut out
   of it (a mask, so it shows whatever is behind, hovered or not). The
   "+n" bubble is the same height. */
.nav-titles {
  display: inline-flex;
  align-items: center;
}

.nav-titles__icon,
.nav-titles__more {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  height: 22px;
  border-radius: 999px;
  overflow: hidden;
}

.nav-titles__icon {
  width: 22px;
}

/* The next item's left edge is a circle centred 5px past this one's right
   edge (22px - 6px overlap + 11px radius); cut it out 2px wider. */
.nav-titles__icon:not(:last-child) {
  -webkit-mask-image: radial-gradient(circle at calc(100% + 5px) 50%, transparent 12.5px, #000 13px);
  mask-image: radial-gradient(circle at calc(100% + 5px) 50%, transparent 12.5px, #000 13px);
}

/* Right to left, the next item sits on the left: cut that side. */
/* An unscoped ancestor, not :global(): Vue turns ":global(.x) .y" into a
   bare ".x" rule (it masked every right-to-left element). */
.v-locale--is-rtl .nav-titles__icon:not(:last-child) {
  -webkit-mask-image: radial-gradient(circle at -5px 50%, transparent 12.5px, #000 13px);
  mask-image: radial-gradient(circle at -5px 50%, transparent 12.5px, #000 13px);
}

.nav-titles__icon + .nav-titles__icon,
.nav-titles__icon + .nav-titles__more {
  margin-inline-start: -6px;
}

.nav-titles__more {
  min-width: 22px;
  padding: 0 5px;
  font-size: 0.625rem;
  font-weight: 600;
  line-height: 1;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface));
}
</style>
