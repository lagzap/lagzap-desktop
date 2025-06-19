<script setup lang="ts">
import { useDisplay, useTheme } from "vuetify";
import { Events, System, Window } from "@wailsio/runtime";
import { useMessagesStore } from "~/stores/messages";
import { GetNodes, GetRegions, GetTitles, StopService } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { EchoResult } from "./bindings/github.com/lagzap/lagzap/adapter";

const store = useStore();
const messages = useMessagesStore();
const { logout } = useSanctumAuth();

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
Events.On("service-started", async () => {
  await store.checkService()
  await nextTick()
  await new Promise((resolve) => { // timeout for animations
    setTimeout(() => {
      resolve(true);
    }, 1000);
  });
  await store.optimize()
});
Events.On("service-stopped", async () => await store.checkService());
Events.On("echo-test", ({ data }) => {
  data.forEach((item) => {
    const { Tag, Result } = item as { Tag: string; Result: EchoResult };
    store.setNodeLatency(Tag, Result);
  });
});
Events.On("titles", ({ data }) => store.upsertTitles(data[0]));
Events.On("regions", ({ data }) => store.upsertRegions(data[0]));
Events.On("nodes", ({ data }) => store.upsertNodes(data[0]));

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
const closing = ref(false);
async function close() {
  closing.value = true;
  try {
    await store.stopNDIS();
    await store.stopService();
  } catch (e) {
    displayError(e);
  } finally {
    await Window.Close();
  }
}
</script>

<template>
  <NuxtLayout :class="{ 'layout-enter-active': !loaded }">
    <NuxtPage />
  </NuxtLayout>
  <div
    class="align-self-start position-fixed top-0"
    :class="{
      'left-0': $vuetify.locale.isRtl,
      'right-0': !$vuetify.locale.isRtl,
    }"
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
    <v-dialog v-if="store.serviceReady && store.ndisRunning" max-width="500" :persistent="closing">
      <template v-slot:activator="{ props: activatorProps }">
        <v-btn
          icon
          rounded="0"
          variant="plain"
          color="accent"
          :density="mobile ? 'comfortable' : 'default'"
          :height="48"
          style="--wails-draggable: none; margin-inline-end: 0"
          v-bind="activatorProps"
        >
          <v-icon size="sm" icon="mdi-close" />
        </v-btn>
      </template>

      <template v-slot:default="{ isActive }">
        <v-card title="Exiting" subtitle="Are you sure you want to exit?" :loading="closing">
          <v-card-text>
            The proxy service is already running, make sure you save your works before exiting completely.
          </v-card-text>

          <v-card-actions>
            <v-btn
              text="Cancel"
              @click="isActive.value = false"
            />
            <v-spacer />

            <v-btn
              text="Logout"
              color="warning"
              @click="logout"
            />
            <v-btn
              text="Exit LagZap"
              color="red"
              :loading="closing"
              @click="close"
            />
          </v-card-actions>
        </v-card>
      </template>
    </v-dialog>
    <v-btn
      v-else
      icon
      rounded="0"
      variant="plain"
      color="accent"
      :density="mobile ? 'comfortable' : 'default'"
      :height="48"
      style="--wails-draggable: none; margin-inline-end: 0"
      :loading="closing"
      @click="close"
    >
      <v-icon size="sm" icon="mdi-close" />
    </v-btn>
  </div>

  <v-snackbar-queue v-model="messages.queue" />
</template>
