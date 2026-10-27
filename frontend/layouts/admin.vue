<script setup lang="ts">
import { useDisplay, useLocale } from "vuetify";
import { closeAdminTools } from "~/composables/useAdminToolsWindow";

const { mobile } = useDisplay();
const { t } = useLocale();
const route = useRoute();
const drawer = ref(true);
const isMaximized = ref(false);

// Subscribe to monitoring events in this webview (no auth / no main store init).
useMonitoringStore();

const navItems = computed(() => [
  {
    name: "admin-connections",
    title: t("$vuetify.navigation.connections"),
    icon: "mdi-network-outline",
  },
  {
    name: "admin-routes",
    title: "Route Monitoring",
    icon: "mdi-network-pos",
  },
  {
    name: "admin-path-pings",
    title: "Path Pings",
    icon: "mdi-swap-horizontal-variant",
  },
  {
    name: "admin-relays",
    title: "Relays",
    icon: "mdi-server-network",
  },
  {
    name: "admin-live",
    title: "Live Relay Monitor",
    icon: "mdi-radar",
  },
  {
    name: "admin-logs",
    title: t("$vuetify.navigation.logs"),
    icon: "mdi-text",
  },
]);

onMounted(async () => {
  const { Window, Events } = await import("@wailsio/runtime");
  isMaximized.value = await Window.IsMaximised();
  Events.On("WindowMaximised", async () => {
    isMaximized.value = await Window.IsMaximised();
  });
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

async function closeWindow() {
  await closeAdminTools();
}
</script>

<template>
  <v-app class="admin-layout">
    <v-app-bar
      flat
      density="comfortable"
      color="surface"
      style="--wails-draggable: drag"
    >
      <v-app-bar-nav-icon
        style="--wails-draggable: none"
        @click="drawer = !drawer"
      />
      <v-app-bar-title class="text-subtitle-1">
        Admin Tools
      </v-app-bar-title>
      <v-spacer />
      <div
        class="d-flex"
        style="--wails-draggable: none"
      >
        <v-btn icon variant="plain" density="comfortable" @click="minimize">
          <v-icon size="sm" icon="mdi-window-minimize" />
        </v-btn>
        <v-btn
          icon
          variant="plain"
          density="comfortable"
          @click="toggleMaximise"
        >
          <v-icon
            size="sm"
            :icon="isMaximized ? 'mdi-window-restore' : 'mdi-window-maximize'"
          />
        </v-btn>
        <v-btn icon variant="plain" density="comfortable" @click="closeWindow">
          <v-icon size="sm" icon="mdi-close" />
        </v-btn>
      </div>
    </v-app-bar>

    <v-navigation-drawer
      v-model="drawer"
      :permanent="!mobile"
      width="240"
    >
      <v-list nav density="compact" color="tertiary">
        <v-list-subheader>{{ t("$vuetify.navigation.admin") }}</v-list-subheader>
        <v-list-item
          v-for="item in navItems"
          :key="item.name"
          :to="{ name: item.name }"
          :title="item.title"
          :prepend-icon="item.icon"
          :active="route.name === item.name"
          rounded="xl"
        />
      </v-list>
    </v-navigation-drawer>

    <slot />
  </v-app>
</template>

<style scoped>
.admin-layout {
  height: 100%;
}
</style>
