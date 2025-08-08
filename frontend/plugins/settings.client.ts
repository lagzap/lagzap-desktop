export default defineNuxtPlugin(async () => {
  // Wait for Vuetify to be initialized before loading settings
  await nextTick()
  
  const { loadSettings } = useSettings()
  
  // Add a small delay to ensure Vuetify is fully ready
  setTimeout(async () => {
    try {
      await loadSettings()
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }, 100)
})
