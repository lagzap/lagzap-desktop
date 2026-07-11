export default defineNuxtPlugin(async () => {
  const { loadSettings } = useSettings();
  registerRoutingSettingsSync();
  try {
    await loadSettings();
  } catch (error) {
    console.error("Failed to load settings:", error);
  }
});
