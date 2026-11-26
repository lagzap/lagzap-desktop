<script setup lang="ts">
import { useLocale } from "vuetify";
import { ConnectionStatus } from "~/bindings/github.com/lagzap/lagzap/adapter";
import { Connect, IsConnecting } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { localDigits } from "~/utils/localeFormat";

/** A small floating card at the bottom while the app cannot reach the cloud
 * service; it confirms briefly once the connection is back, then goes away.
 * Offline (not retrying on its own), Retry tries now, then rests a moment. */

const { t } = useLocale();
const store = useStore();

// Short blips (a reconnect that succeeds right away) never show the card.
const SHOW_AFTER_MS = 2500;
const CONNECTED_FOR_MS = 1500;

const visible = ref(false);
const recovered = ref(false);
let showTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function clearTimers() {
  if (showTimer) clearTimeout(showTimer);
  if (hideTimer) clearTimeout(hideTimer);
  showTimer = hideTimer = null;
}

watch(
  () => store.connected,
  (connected) => {
    clearTimers();
    if (!connected) {
      recovered.value = false;
      showTimer = setTimeout(() => (visible.value = true), SHOW_AFTER_MS);
      return;
    }
    if (!visible.value) return;
    recovered.value = true;
    hideTimer = setTimeout(() => {
      visible.value = false;
      recovered.value = false;
    }, CONNECTED_FOR_MS);
  },
  { immediate: true },
);

// Retry: connects now, then waits RETRY_COOLDOWN_S before it can again.
const RETRY_COOLDOWN_S = 8;
const cooldown = ref(0);
let cooldownTimer: ReturnType<typeof setInterval> | null = null;

async function retry() {
  if (cooldown.value > 0) return;
  cooldown.value = RETRY_COOLDOWN_S;
  cooldownTimer = setInterval(() => {
    cooldown.value -= 1;
    if (cooldown.value <= 0 && cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
  }, 1000);
  try {
    // An attempt already under way is left to finish, not restarted.
    if (!(await IsConnecting())) await Connect();
  } catch {
    // Still offline: the card stays, Retry comes back after the cooldown.
  }
}

onUnmounted(() => {
  clearTimers();
  if (cooldownTimer) clearInterval(cooldownTimer);
});

const reconnecting = computed(() => store.status == ConnectionStatus.StatusReconnecting);
/** Offline and not retrying on its own: Retry is offered. */
const canRetry = computed(() => !recovered.value && !reconnecting.value);

const state = computed(() => {
  if (recovered.value) {
    return { icon: "mdi-check", color: "success", title: t("$vuetify.status.internetOnline"), hint: "" };
  }
  if (reconnecting.value) {
    return { icon: "", color: "primary", title: t("$vuetify.status.internetReconnecting"), hint: t("$vuetify.status.offlineHint") };
  }
  return { icon: "mdi-cloud-off-outline", color: "warning", title: t("$vuetify.status.offline"), hint: t("$vuetify.status.offlineHint") };
});
</script>

<template>
  <Teleport to="body">
    <div class="cloud-status-dock">
    <v-slide-y-reverse-transition>
      <v-card
        v-if="visible"
        class="cloud-status-card"
        color="surface"
        elevation="8"
        border
        rounded="lg"
        role="status"
        aria-live="polite"
      >
        <div class="d-flex align-center ga-3 px-3 py-2">
          <v-avatar :color="state.color" variant="tonal" size="28">
            <v-progress-circular v-if="!state.icon" indeterminate size="14" width="2" />
            <v-icon v-else :icon="state.icon" size="16" />
          </v-avatar>
          <div class="min-w-0">
            <div class="text-body-2 font-weight-medium">
              <span class="text-medium-emphasis">{{ t("$vuetify.status.coordinatorService") }}:</span>
              {{ state.title }}
            </div>
            <div v-if="state.hint" class="text-caption text-medium-emphasis text-truncate">
              {{ state.hint }}
            </div>
          </div>
          <v-btn
            v-if="canRetry"
            size="small"
            variant="tonal"
            class="text-none flex-0-0 ms-1"
            prepend-icon="mdi-refresh"
            :disabled="cooldown > 0"
            @click="retry"
          >
            {{
              cooldown > 0
                ? t("$vuetify.status.retryConnectIn", localDigits(cooldown))
                : t("$vuetify.status.retryConnect")
            }}
          </v-btn>
        </div>
      </v-card>
    </v-slide-y-reverse-transition>
    </div>
  </Teleport>
</template>

<style scoped>
/* Centered at the bottom; the dock lets clicks through around the card. */
.cloud-status-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 16px;
  display: flex;
  justify-content: center;
  z-index: 1900;
  pointer-events: none;
}

.cloud-status-card {
  pointer-events: auto;
  max-width: min(420px, calc(100vw - 32px));
}

.min-w-0 {
  min-width: 0;
}
</style>
