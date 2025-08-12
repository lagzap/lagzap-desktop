export default defineNuxtPlugin(async () => {
  // Wait for Vuetify to be initialized before loading settings
  await nextTick();

  const { loadSettings } = useSettings();

  try {
    await loadSettings();
  } catch (error) {
    console.error("Failed to load settings:", error);
  }
});
