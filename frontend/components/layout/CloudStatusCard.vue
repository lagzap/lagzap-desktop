<script setup lang="ts">
import { useLocale } from "vuetify";
import { ConnectionStatus } from "~/bindings/github.com/lagzap/lagzap/adapter";

/** A small floating card at the bottom while the app cannot reach the cloud
 * service; it confirms briefly once the connection is back, then goes away. */

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

onUnmounted(clearTimers);

const reconnecting = computed(() => store.status == ConnectionStatus.StatusReconnecting);

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
