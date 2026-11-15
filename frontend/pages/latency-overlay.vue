<script setup lang="ts">
import { Events, Window } from "@wailsio/runtime";
import { useElementSize } from "@vueuse/core";
import { useLocale, useTheme } from "vuetify";
import OverviewChart from "~/components/network/OverviewChart.vue";
import {
  closeLatencyOverlay,
  loadOverlayAlwaysOnTop,
  loadOverlayOpacity,
  saveOverlayAlwaysOnTop,
  saveOverlayOpacity,
  setLatencyOverlayAlwaysOnTop,
} from "~/composables/useLatencyOverlayWindow";
import {
  syncThemeFromSetting,
  type AppThemeSetting,
} from "~/composables/useSettings";

definePageMeta({
  layout: "overlay",
  sanctum: {
    excluded: true,
  },
});

const { t } = useLocale();
const locale = useLocale();
const theme = useTheme();
const { settings, isLoaded } = useSettings(locale, theme);

const opacity = ref(loadOverlayOpacity());
const alwaysOnTop = ref(loadOverlayAlwaysOnTop());
const opacityOpen = ref(false);

// The chart fills the window at any size the user drags it to.
const body = ref<HTMLElement | null>(null);
const { height: bodyHeight } = useElementSize(body);
const chartHeight = computed(() => Math.max(60, Math.floor(bodyHeight.value)));

const panelStyle = computed(() => {
  const isDark = theme.global.current.value.dark;
  return {
    opacity: opacity.value,
    background: isDark ? "rgba(18, 18, 18, 0.94)" : "rgba(245, 245, 245, 0.94)",
    borderColor: isDark ? "rgba(230, 215, 133, 0.22)" : "rgba(0, 0, 0, 0.12)",
    borderTopColor: isDark ? "rgba(230, 215, 133, 0.55)" : "rgba(180, 150, 40, 0.55)",
  };
});

async function applyWindowBackgroundAlpha(value: number) {
  const alpha = Math.round(Math.min(1, Math.max(0.35, value)) * 255);
  const isDark = theme.current.value.dark;
  if (isDark) {
    await Window.SetBackgroundColour(18, 18, 18, alpha);
  } else {
    await Window.SetBackgroundColour(245, 245, 245, alpha);
  }
}

async function syncOverlayTheme(themeSetting?: AppThemeSetting) {
  await syncThemeFromSetting(themeSetting ?? settings.value.theme ?? "system", theme);
  await applyWindowBackgroundAlpha(opacity.value);
}

watch(opacity, (value) => {
  saveOverlayOpacity(value);
  applyWindowBackgroundAlpha(value).catch(() => {
    /* ignore */
  });
});

watch(alwaysOnTop, async (value) => {
  saveOverlayAlwaysOnTop(value);
  try {
    await setLatencyOverlayAlwaysOnTop(value);
  } catch {
    // Window may not be ready yet on first paint.
  }
});

watch(
  isLoaded,
  (loaded) => {
    if (loaded) {
      syncOverlayTheme().catch(() => {
        /* ignore */
      });
    }
  },
  { immediate: true }
);

watch(
  () => theme.global.current.value.dark,
  () => {
    applyWindowBackgroundAlpha(opacity.value).catch(() => {
      /* ignore */
    });
  }
);

onMounted(async () => {
  Events.On("app-theme-changed", ({ data }) => {
    syncOverlayTheme(data as AppThemeSetting).catch(() => {
      /* ignore */
    });
  });
  Events.On("theme", ({ data }) => {
    if (!settings.value.theme || settings.value.theme === "system") {
      theme.change(data);
      applyWindowBackgroundAlpha(opacity.value).catch(() => {
        /* ignore */
      });
    }
  });

  try {
    await setLatencyOverlayAlwaysOnTop(alwaysOnTop.value);
    if (isLoaded.value) {
      await syncOverlayTheme();
    }
  } catch {
    /* ignore */
  }
});

onUnmounted(() => {
  Events.Off("app-theme-changed", "theme");
});

async function dockBack() {
  try {
    await closeLatencyOverlay();
  } catch {
    await Window.Close();
  }
}
</script>

<template>
  <div
    class="latency-overlay"
    :style="panelStyle">
    <div
      class="latency-overlay__chrome"
      style="--wails-draggable: drag">
      <div class="latency-overlay__title text-caption text-medium-emphasis">
        {{ t("$vuetify.networkLatency.latency") }}
      </div>
      <div
        class="latency-overlay__actions"
        :class="{ 'latency-overlay__actions--shown': opacityOpen }"
        style="--wails-draggable: none">
        <v-btn
          icon
          size="x-small"
          variant="text"
          density="comfortable"
          :color="alwaysOnTop ? 'accent' : undefined"
          :title="t('$vuetify.networkLatency.overlayAlwaysOnTop')"
          :aria-pressed="alwaysOnTop"
          @click="alwaysOnTop = !alwaysOnTop">
          <v-icon
            size="small"
            :icon="alwaysOnTop ? 'mdi-pin' : 'mdi-pin-outline'" />
        </v-btn>
        <v-btn
          icon
          size="x-small"
          variant="text"
          density="comfortable"
          :color="opacityOpen ? 'accent' : undefined"
          :title="t('$vuetify.networkLatency.overlayOpacity')"
          :aria-pressed="opacityOpen"
          @click="opacityOpen = !opacityOpen">
          <v-icon
            size="small"
            icon="mdi-circle-half-full" />
        </v-btn>
        <v-btn
          icon
          size="x-small"
          variant="text"
          density="comfortable"
          :title="t('$vuetify.networkLatency.dockIn')"
          @click="dockBack">
          <v-icon
            size="small"
            icon="mdi-dock-window" />
        </v-btn>
      </div>
    </div>

    <div
      v-if="opacityOpen"
      class="latency-overlay__opacity"
      style="--wails-draggable: none">
      <v-icon
        size="x-small"
        icon="mdi-circle-half-full"
        class="text-medium-emphasis" />
      <v-slider
        v-model="opacity"
        :min="0.35"
        :max="1"
        :step="0.05"
        density="compact"
        hide-details
        color="accent"
        track-color="rgba(var(--v-theme-on-surface), 0.3)"
        class="latency-overlay__slider"
        :thumb-size="12"
        :track-size="3"
        :aria-label="t('$vuetify.networkLatency.overlayOpacity')" />
      <span class="latency-overlay__percent text-caption text-medium-emphasis">
        {{ Math.round(opacity * 100) }}%
      </span>
    </div>

    <div
      ref="body"
      class="latency-overlay__body"
      style="--wails-draggable: none">
      <OverviewChart
        compact
        :chart-height="chartHeight" />
    </div>
  </div>
</template>

<style scoped>
.latency-overlay {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  border-radius: 10px;
  border-width: 1px;
  border-style: solid;
  border-top-width: 2px;
  overflow: hidden;
  color: inherit;
}

.latency-overlay__chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 4px 0 10px;
  min-height: 28px;
  flex-shrink: 0;
  cursor: grab;
}

.latency-overlay__title {
  user-select: none;
  pointer-events: none;
}

/* The buttons show while the pointer is on the window (or a setting is
   open), so the chart stays clean the rest of the time. */
.latency-overlay__actions {
  display: flex;
  align-items: center;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.latency-overlay:hover .latency-overlay__actions,
.latency-overlay__actions--shown,
.latency-overlay__actions:focus-within {
  opacity: 1;
}

.latency-overlay__opacity {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 2px;
  flex-shrink: 0;
}

.latency-overlay__slider {
  flex: 1 1 auto;
  min-width: 0;
}

.latency-overlay__slider :deep(.v-slider__container) {
  min-inline-size: 0;
}

.latency-overlay__percent {
  min-width: 34px;
  text-align: end;
  font-variant-numeric: tabular-nums;
}

.latency-overlay__body {
  flex: 1;
  min-height: 0;
  padding: 0 8px 6px;
  overflow: hidden;
}
</style>
