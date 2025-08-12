<script setup lang="ts">
import { useDisplay, useTheme, useLocale } from "vuetify";
import { Events, System, Window } from "@wailsio/runtime";
import { useMessagesStore } from "~/stores/messages";

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
const { settings, loadSettings, isLoaded } = useSettings(locale, theme);

const isMaximized = ref<boolean>(false);
const loaded = ref(false);

onMounted(async () => {
  await loadSettings();
  setTimeout(() => {
    loaded.value = true;
  }, 300);
  isMaximized.value = await Window.IsMaximised();
});

watch(isLoaded, (loaded) => {
  if (loaded && (!settings.value.theme || settings.value.theme === "system")) {
    System.IsDarkMode().then((systemTheme) => {
      theme.change(systemTheme ? "dark" : "light");
    });
  }
});

Events.On("theme", ({ data }) => {
  if (!settings.value.theme || settings.value.theme === "system") {
    theme.change(data[0]);
  }
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
  <NuxtLayout :class="{ 'layout-enter-active': !loaded }">
    <NuxtPage />
  </NuxtLayout>
  <div
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

  <v-snackbar-queue v-model="messages.queue" />
</template>
