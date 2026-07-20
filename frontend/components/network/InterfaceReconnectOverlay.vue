<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Events } from "@wailsio/runtime";
import { useLocale } from "vuetify";
import type { InterfaceGraceEvent } from "~/types/monitoring";

const { t } = useLocale();

const active = ref(false);
const expired = ref(false);
const deadlineMs = ref(0);
const lostInterfaces = ref<string[]>([]);
const nowMs = ref(Date.now());

let tickTimer: ReturnType<typeof setInterval> | null = null;

const secondsLeft = computed(() => {
  if (!active.value || deadlineMs.value <= 0) {
    return 0;
  }
  return Math.max(0, Math.ceil((deadlineMs.value - nowMs.value) / 1000));
});

function applyGraceEvent(event: InterfaceGraceEvent) {
  if (event.active) {
    active.value = true;
    expired.value = false;
    deadlineMs.value = event.deadline_unix_ms;
    lostInterfaces.value = event.lost_interfaces ?? [];
    nowMs.value = Date.now();
    return;
  }

  active.value = false;
  expired.value = event.expired === true;
  deadlineMs.value = 0;
  lostInterfaces.value = [];
}

function startTicker() {
  if (tickTimer) {
    return;
  }
  tickTimer = setInterval(() => {
    nowMs.value = Date.now();
    if (active.value && deadlineMs.value > 0 && nowMs.value >= deadlineMs.value) {
      active.value = false;
      expired.value = true;
    }
  }, 200);
}

onMounted(() => {
  startTicker();
  Events.On("interface-grace", ({ data }) => {
    if (data) {
      applyGraceEvent(data as InterfaceGraceEvent);
    }
  });
});

onUnmounted(() => {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
});
</script>

<template>
  <v-dialog
    :model-value="active"
    persistent
    max-width="420"
    scrim="rgba(0,0,0,0.72)"
  >
    <v-card class="interface-reconnect-card pa-6 text-center" rounded="xl">
      <div class="plug-icon-wrap mx-auto mb-4">
        <v-icon icon="mdi-ethernet-cable" size="56" color="error" />
      </div>

      <v-card-title class="text-h6 font-weight-bold px-0">
        {{ t("$vuetify.status.interfaceReconnectTitle") }}
      </v-card-title>

      <v-card-text class="px-0 pt-2">
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ t("$vuetify.status.interfaceReconnectBody") }}
        </p>

        <div class="countdown text-error font-weight-bold">
          {{ secondsLeft }}s
        </div>

        <p
          v-if="lostInterfaces.length > 0"
          class="text-caption text-medium-emphasis mt-4 mb-0"
        >
          {{ lostInterfaces.join(", ") }}
        </p>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.plug-icon-wrap {
  width: 88px;
  height: 88px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  background: rgb(var(--v-theme-error) / 0.12);
  animation: plug-pulse 1.2s ease-in-out infinite;
}

.countdown {
  font-size: 3rem;
  line-height: 1;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
}

@keyframes plug-pulse {
  0%,
  100% {
    transform: scale(1);
    box-shadow: 0 0 0 0 rgb(var(--v-theme-error) / 0.35);
  }
  50% {
    transform: scale(1.04);
    box-shadow: 0 0 0 12px rgb(var(--v-theme-error) / 0);
  }
}
</style>
