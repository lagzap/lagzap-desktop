<script lang="ts" setup>
import { computed, ref, onMounted, onUnmounted } from "vue";
import { Events } from "@wailsio/runtime";
import { useLocale, useTheme } from "vuetify";
import OverviewChart from "~/components/network/OverviewChart.vue";
import {
  getScoreColorClass,
  type MultiInterfaceLatency,
} from "~/composables/useLatencyMetrics";
import { isPingTimeout } from "~/constants/pingChart";
import {
  isLatencyOverlayOpen,
  openLatencyOverlay,
} from "~/composables/useLatencyOverlayWindow";

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
const combinedScore = computed(() => props.latency?.best_score || 0);
// Lowest last ping across NICs, like the Overview card's best interface.
const lastPingDisplay = computed(() => {
  let best = Infinity;
  for (const iface of Object.values(props.latency?.interfaces ?? {})) {
    const last = iface.pings?.[iface.pings.length - 1];
    if (last?.ok && !isPingTimeout(last.latency, last.ok)) best = Math.min(best, last.latency);
  }
  return Number.isFinite(best) ? formatMs(best, "--") : "--";
});

async function refreshOverlayState() {
  try {
    overlayOpen.value = await isLatencyOverlayOpen();
  } catch {
    overlayOpen.value = false;
  }
}

async function popOut() {
  menuVisible.value = false;
  try {
    await openLatencyOverlay();
    overlayOpen.value = true;
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
          <span class="text-subtitle-2 ps-4">{{ t("$vuetify.networkLatency.latency") }}</span>
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
          <OverviewChart compact :chart-height="150" />
        </v-card-text>
      </v-card>
    </v-menu>
  </div>
</template>

<style scoped>
.cursor-pointer {
  cursor: pointer;
}

.latency-chip-card {
  border: 2.5px solid rgba(var(--v-theme-on-surface), 0.22) !important;
  border-radius: 12px !important;
  overflow: hidden;
}

.latency-chip-card__toolbar {
  display: flex;
  align-items: center;
  padding: 4px 4px 0;
  min-height: 28px;
}
</style>
