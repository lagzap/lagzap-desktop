<script lang="ts" setup>
import { ref, toRef, onMounted, onUnmounted } from "vue";
import { Events } from "@wailsio/runtime";
import { useLocale, useTheme } from "vuetify";
import LatencyPanel from "~/components/network/LatencyPanel.vue";
import {
  getScoreColorClass,
  useLatencyMetrics,
  type MultiInterfaceLatency,
} from "~/composables/useLatencyMetrics";
import {
  isLatencyOverlayOpen,
  openLatencyOverlay,
} from "~/composables/useLatencyOverlayWindow";
import { publishLatencySnapshot } from "~/composables/latencySync";

const props = defineProps<{
  latency?: MultiInterfaceLatency | null;
}>();

const { t } = useLocale();
const locale = useLocale();
const theme = useTheme();
const { settings } = useSettings(locale, theme);
const store = useStore();
const menuVisible = ref(false);
const overlayOpen = ref(false);
const { lastPingDisplay, combinedScore } = useLatencyMetrics(
  toRef(props, "latency")
);

async function refreshOverlayState() {
  try {
    overlayOpen.value = await isLatencyOverlayOpen();
  } catch {
    overlayOpen.value = false;
  }
}

async function publishOverlayLatencySnapshot() {
  if (!store.latency) {
    return;
  }
  publishLatencySnapshot({
    latency: store.latency,
    latencyPingCache: store.latencyPingCache,
  });
}

async function popOut() {
  menuVisible.value = false;
  try {
    await openLatencyOverlay();
    overlayOpen.value = true;
    window.setTimeout(() => {
      void publishOverlayLatencySnapshot();
    }, 300);
    const themeSetting = settings.value.theme || "system";
    window.setTimeout(() => {
      Events.Emit("app-theme-changed", themeSetting);
    }, 300);
  } catch (err) {
    console.error("Failed to open latency overlay", err);
  }
}

onMounted(() => {
  refreshOverlayState();
  Events.On("latency-overlay-opened", () => {
    overlayOpen.value = true;
    menuVisible.value = false;
    window.setTimeout(() => {
      void publishOverlayLatencySnapshot();
    }, 200);
  });
  Events.On("latency-overlay-closed", () => {
    overlayOpen.value = false;
  });
});

onUnmounted(() => {
  Events.Off("latency-overlay-opened");
  Events.Off("latency-overlay-closed");
});
</script>

<template>
  <div>
    <v-menu
      v-model:model-value="menuVisible"
      location="bottom center"
      :disabled="overlayOpen"
    >
      <template #activator="{ props: menuProps }">
        <v-chip
          v-bind="overlayOpen ? {} : menuProps"
          size="small"
          rounded="full"
          variant="text"
          :color="getScoreColorClass(combinedScore)"
          class="cursor-pointer"
          :title="
            overlayOpen
              ? t('$vuetify.networkLatency.overlayOpenHint')
              : undefined
          "
          @click="overlayOpen ? popOut() : undefined"
        >
          {{ lastPingDisplay }}
        </v-chip>
      </template>

      <v-card min-width="380" max-width="420" class="latency-chip-card">
        <div class="latency-chip-card__toolbar">
          <v-spacer />
          <v-btn
            icon
            size="x-small"
            variant="text"
            density="comfortable"
            :title="t('$vuetify.networkLatency.popOut')"
            @click.stop="popOut"
          >
            <v-icon size="small" icon="mdi-open-in-new" />
          </v-btn>
        </div>
        <v-card-text v-if="menuVisible" class="pt-0">
          <LatencyPanel :latency="latency" :active="menuVisible" compact />
        </v-card-text>
      </v-card>
    </v-menu>
  </div>
</template>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}

.latency-chip-card__toolbar {
  display: flex;
  align-items: center;
  padding: 4px 4px 0;
  min-height: 28px;
}
</style>
