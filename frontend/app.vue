<script setup lang="ts">
import { useDisplay, useTheme } from "vuetify";
import { Events, System, Window } from "@wailsio/runtime";
import { useMessagesStore } from "~/stores/messages";
import {
  StopService,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { EchoResult } from "./bindings/github.com/lagzap/lagzap/adapter";

const store = useStore();
const messages = useMessagesStore();

const loaded = ref(false);
onMounted(() => {
  setTimeout(() => {
    loaded.value = true;
  }, 300);
});

const theme = useTheme();
const { mobile } = useDisplay();

System.IsDarkMode().then((systemTheme) => {
  theme.global.name.value = systemTheme ? 'dark' : 'light';
})

Events.On("theme", ({ data }) => {
  theme.global.name.value = data[0];
});

Events.On("echo-test", ({ data }) => {
  data.forEach((item) => {
    const { Tag, Result } = item as { Tag: string; Result: EchoResult };
    store.setNodeLatency(Tag, Result);
  });
});
Events.On("service-started", async () => {
  await store.checkService();
});
Events.On("service-stopped", async () => {
  await store.checkService();
});

const isMaximized = ref<boolean>(false);
onMounted(async () => {
  await store.checkService();
  isMaximized.value = await Window.IsMaximised();
});

onUnmounted(async () => {
  await StopService();
});

async function minimize() {
  await Window.Minimise();
}
async function toggleMaximise() {
  await Window.ToggleMaximise();
  isMaximized.value = await Window.IsMaximised();
}
async function close() {
  await Window.Close();
}
</script>

<template>
  <NuxtLayout :class="{ 'layout-enter-active': !loaded }">
    <NuxtPage />
  </NuxtLayout>
  <div
    class="align-self-start position-fixed top-0 right-0"
    style="z-index: 2005"
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
