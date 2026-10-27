import type { createVuetify } from "vuetify";

export default defineNuxtPlugin({
  name: "settings",
  dependsOn: ["vuetify"],
  async setup(nuxtApp) {
    // Pass Vuetify's locale and theme: without them loadSettings restores
    // the saved language into the selector but never switches the UI to it.
    const vuetify = nuxtApp.$vuetifyInstance as ReturnType<typeof createVuetify>;
    const { loadSettings } = useSettings(vuetify.locale, vuetify.theme);
    registerRoutingSettingsSync();
    registerNetworkAdapterSettingsSync();
    try {
      await loadSettings();
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  },
});
