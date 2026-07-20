<script setup lang="ts">
import { useDisplay, useTheme, useLocale } from "vuetify";
import { Events, Window } from "@wailsio/runtime";
import { useMessagesStore } from "~/stores/messages";
import OptimizeParticles from "~/components/effects/OptimizeParticles.vue";
import InterfaceReconnectOverlay from "~/components/network/InterfaceReconnectOverlay.vue";
import {
  syncThemeFromSetting,
  type AppThemeSetting,
} from "~/composables/useSettings";

const store = useStore();
const messages = useMessagesStore();
window.addEventListener(
  "auxclick",
  (e) => {
    if (e.button === 1) {
      // Middle click
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  },
  true
);

const theme = useTheme();
const locale = useLocale();
const { mobile } = useDisplay();
const { settings, isLoaded } = useSettings(locale, theme);

const isMaximized = ref<boolean>(false);
const loaded = ref(false);
const route = useRoute();
/** First paint after spa-loading-template → start-service: fade, not zoom. */
const isStartServiceBoot = computed(
  () =>
    route.meta.layout === "start" || route.path.startsWith("/start-service")
);
/** Pop-out latency window uses its own chrome; hide main title-bar buttons. */
const isOverlayWindow = computed(
  () =>
    route.meta.layout === "overlay" ||
    route.path.startsWith("/latency-overlay")
);

onMounted(async () => {
  if (isLoaded.value) {
    await syncThemeFromSetting(settings.value.theme ?? "system", theme);
  }
  setTimeout(() => {
    loaded.value = true;
  }, 300);
  isMaximized.value = await Window.IsMaximised();
});

watch(isLoaded, async (loaded) => {
  if (!loaded) {
    return;
  }
  await syncThemeFromSetting(settings.value.theme ?? "system", theme);
});

Events.On("app-theme-changed", ({ data }) => {
  syncThemeFromSetting(data as AppThemeSetting, theme);
});

Events.On("theme", ({ data }) => {
  if (!settings.value.theme || settings.value.theme === "system") {
    theme.change(data);
  }
});

Events.On("WindowMaximised", async ({ data }) => {
  isMaximized.value = await Window.IsMaximised();
});

async function minimize() {
  await Window.Minimise();
}
async function toggleMaximise() {
  await Window.ToggleMaximise();
  isMaximized.value = await Window.IsMaximised();
}
async function close() {
  await Window.Hide();
}
</script>

<template>
  <NuxtLayout
    :class="{
      'layout-enter-active': !loaded && !isStartServiceBoot,
      'layout-fade-enter-active': !loaded && isStartServiceBoot,
    }"
  >
    <NuxtPage />
  </NuxtLayout>
  <div
    v-if="!isOverlayWindow"
    class="d-flex align-self-start position-fixed top-0"
    :class="{
      'flex-row-reverse': $vuetify.locale.isRtl,
      'left-0': $vuetify.locale.isRtl,
      'right-0': !$vuetify.locale.isRtl,
    }"
    style="z-index: 99999 !important"
  >
    <v-btn
      icon
      rounded="0"
      variant="plain"
      color="accent"
      :density="mobile ? 'comfortable' : 'default'"
      :height="48"
      style="--wails-draggable: none"
      @click="minimize"
    >
      <v-icon size="sm" icon="mdi-window-minimize" />
    </v-btn>
    <v-btn
      icon
      rounded="0"
      variant="plain"
      color="accent"
      :density="mobile ? 'comfortable' : 'default'"
      :height="48"
      style="--wails-draggable: none"
      @click="toggleMaximise"
    >
      <v-icon
        size="sm"
        :icon="
          isMaximized.valueOf() ? 'mdi-window-restore' : 'mdi-window-maximize'
        "
      />
    </v-btn>
    <v-btn
      icon
      rounded="0"
      variant="plain"
      color="accent"
      :density="mobile ? 'comfortable' : 'default'"
      :height="48"
      style="--wails-draggable: none; margin-inline-end: 0"
      @click="close"
    >
      <v-icon size="sm" icon="mdi-close" />
    </v-btn>
  </div>

  <v-snackbar-queue
    v-if="!isOverlayWindow"
    v-model="messages.queue"
    :timeout="1000"
  />

  <InterfaceReconnectOverlay v-if="!isOverlayWindow" />

  <OptimizeParticles v-if="!isOverlayWindow" />
</template>

<style lang="scss">
.v-application.v-layout.v-layout--full-height.v-theme--dark {
  background:
    radial-gradient(ellipse 80% 50% at 50% -10%, rgb(230 215 133 / 0.03), transparent),
    linear-gradient(180deg, #141414 0%, #0a0a0a 100%);
}

.overlay-layout.v-application {
  background: transparent !important;
}
</style>