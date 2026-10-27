<script setup lang="ts">
import { Events, Window } from "@wailsio/runtime";
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
const store = useStore();
const { settings, isLoaded } = useSettings(locale, theme);

const opacity = ref(loadOverlayOpacity());
const alwaysOnTop = ref(loadOverlayAlwaysOnTop());
const settingsOpen = ref(false);

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
  <div class="latency-overlay" :style="panelStyle">
    <div class="latency-overlay__chrome" style="--wails-draggable: drag">
      <div class="latency-overlay__title text-caption text-medium-emphasis">
        {{ t("$vuetify.networkLatency.latency") }}
      </div>
      <div class="latency-overlay__actions" style="--wails-draggable: none">
        <v-menu
          v-model="settingsOpen"
          location="bottom end"
          :close-on-content-click="false"
          content-class="overlay-settings-menu"
        >
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              icon
              size="x-small"
              variant="text"
              density="comfortable"
              :title="t('$vuetify.networkLatency.overlaySettings')"
            >
              <v-icon size="small" icon="mdi-tune-variant" />
            </v-btn>
          </template>
          <v-card width="240" class="pa-3 pb-4 overlay-settings-card">
            <div class="text-caption mb-1">
              {{ t("$vuetify.networkLatency.overlayOpacity") }}
            </div>
            <v-slider
              v-model="opacity"
              :min="0.35"
              :max="1"
              :step="0.05"
              density="compact"
              hide-details
              color="accent"
              class="overlay-settings-card__slider"
            />
            <v-switch
              v-model="alwaysOnTop"
              density="compact"
              color="accent"
              hide-details
              class="mt-2 overlay-settings-card__switch"
              :label="t('$vuetify.networkLatency.overlayAlwaysOnTop')"
            />
          </v-card>
        </v-menu>
        <v-btn
          icon
          size="x-small"
          variant="text"
          density="comfortable"
          :title="t('$vuetify.networkLatency.dockIn')"
          @click="dockBack"
        >
          <v-icon size="small" icon="mdi-dock-window" />
        </v-btn>
      </div>
    </div>

    <div class="latency-overlay__body" style="--wails-draggable: none">
      <OverviewChart compact :chart-height="160" />
    </div>
  </div>
</template>

<style scoped>
.latency-overlay {
  display: flex;
  flex-direction: column;
  height: 100vh;
  box-sizing: border-box;
  padding-bottom: 20px;
  border-radius: 12px;
  border-width: 2.5px;
  border-style: solid;
  border-top-width: 2.5px;
  overflow: hidden;
  color: inherit;
}

.latency-overlay__chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 6px 0 12px;
  min-height: 32px;
  flex-shrink: 0;
  cursor: grab;
}

.latency-overlay__title {
  user-select: none;
  pointer-events: none;
}

.latency-overlay__actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.latency-overlay__body {
  flex: 1;
  min-height: 0;
  padding: 4px 12px 8px;
  overflow: hidden;
}

.overlay-settings-card {
  overflow: hidden;
  box-sizing: border-box;
}

.overlay-settings-card__slider {
  overflow: hidden;
  padding-inline: 6px;
  box-sizing: border-box;
}

.overlay-settings-card__slider :deep(.v-slider__container) {
  min-inline-size: 0;
}

.overlay-settings-card__switch {
  max-width: 100%;
}

.overlay-settings-card__switch :deep(.v-label) {
  white-space: normal;
  line-height: 1.2;
}

:global(.overlay-settings-menu) {
  overflow: hidden;
}
</style>
