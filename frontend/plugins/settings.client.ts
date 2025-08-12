export default defineNuxtPlugin(async () => {
  const { loadSettings } = useSettings();
  try {
    await loadSettings();
  } catch (error) {
    console.error("Failed to load settings:", error);
  }
});
