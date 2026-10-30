<script setup lang="ts">
import { useDisplay, useTheme, useLocale } from "vuetify";
import { useMessagesStore } from "~/stores/messages";
import OptimizeParticles from "~/components/effects/OptimizeParticles.vue";
import InterfaceReconnectOverlay from "~/components/network/InterfaceReconnectOverlay.vue";
import DefaultFallbackNotice from "~/components/network/DefaultFallbackNotice.vue";
import RouteProtectedNotice from "~/components/network/RouteProtectedNotice.vue";
import DialogUpdateCheck from "~/components/dialog/UpdateCheck.vue";
import {
  syncThemeFromSetting,
  type AppThemeSetting,
} from "~/composables/useSettings";

const store = useStore();
const messages = useMessagesStore();

const theme = useTheme();
const locale = useLocale();
const { mobile } = useDisplay();
// Numbers and units follow the UI language (Persian digits in fa).
watchEffect(() => {
  formatLocale.value = locale.current.value;
});
const { settings, isLoaded } = useSettings(locale, theme);

const isMaximized = ref<boolean>(false);
const loaded = ref(false);
const route = useRoute();
/** Pop-out latency / admin windows use their own chrome; hide main title-bar buttons. */
const isOverlayWindow = computed(
  () =>
    route.meta.layout === "overlay" ||
    route.meta.layout === "admin" ||
    route.path.startsWith("/latency-overlay") ||
    route.path.startsWith("/admin")
);

onMounted(async () => {
  // Before any await: it reads Nuxt composables from this component.
  void store.resumeSession();
  const { Events, Window } = await import("@wailsio/runtime");

  window.addEventListener(
    "auxclick",
    (e) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );

  if (isLoaded.value) {
    await syncThemeFromSetting(settings.value.theme ?? "system", theme);
  }
  setTimeout(() => {
    loaded.value = true;
  }, 300);
  isMaximized.value = await Window.IsMaximised();

  Events.On("app-theme-changed", ({ data }) => {
    syncThemeFromSetting(data as AppThemeSetting, theme);
  });

  Events.On("theme", ({ data }) => {
    if (!settings.value.theme || settings.value.theme === "system") {
      theme.change(data);
    }
  });

  Events.On("WindowMaximised", async () => {
    isMaximized.value = await Window.IsMaximised();
  });
});

watch(isLoaded, async (value) => {
  if (!value) {
    return;
  }
  await syncThemeFromSetting(settings.value.theme ?? "system", theme);
});

async function minimize() {
  const { Window } = await import("@wailsio/runtime");
  await Window.Minimise();
}
async function toggleMaximise() {
  const { Window } = await import("@wailsio/runtime");
  await Window.ToggleMaximise();
  isMaximized.value = await Window.IsMaximised();
}
async function close() {
  const { Window } = await import("@wailsio/runtime");
  await Window.Hide();
}
</script>

<template>
  <NuxtLayout :class="{ 'layout-enter-active': !loaded }">
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

  <DefaultFallbackNotice v-if="!isOverlayWindow" />

  <DialogSessionRating v-if="!isOverlayWindow" />

  <RouteProtectedNotice v-if="!isOverlayWindow" />

  <DialogUpdateCheck v-if="!isOverlayWindow" />

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
