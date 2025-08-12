import { ref, readonly, toRaw } from 'vue'

interface AppSettings {
  language?: string
  theme?: 'system' | 'light' | 'dark'
  isFirstTime?: boolean
}

const DB_NAME = 'lagzap-settings'
const DB_VERSION = 1
const STORE_NAME = 'settings'

const settings = ref<AppSettings>({
  language: undefined,
  theme: 'system',
  isFirstTime: true
})

const isLoaded = ref(false)

export const useSettings = (locale?: any, theme?: any) => {
  const initDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }
    })
  }

  // Apply theme based on setting
  const applyTheme = (themeSetting: 'system' | 'light' | 'dark') => {
    try {
      if (theme?.global?.name) {
        if (themeSetting === 'system') {
          const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
          theme.change(mediaQuery.matches ? 'dark' : 'light')
          
          mediaQuery.addEventListener('change', (e) => {
            if (settings.value.theme === 'system') {
              theme.change(e.matches ? 'dark' : 'light')
            }
          })
        } else {
          theme.change(themeSetting)
        }
      }
    } catch (error) {
      console.warn('Could not apply theme:', error)
    }
  }

  // Apply locale
  const applyLocale = (language: string) => {
    try {
      if (locale?.current) {
        locale.current.value = language
      }
    } catch (error) {
      console.warn('Could not apply locale:', error)
    }
  }

  // Load settings from IndexedDB
  const loadSettings = async (): Promise<void> => {
    try {
      const db = await initDB()
      const transaction = db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      
      return new Promise((resolve, reject) => {
        const request = store.get('app-settings')
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const result = request.result
          if (result) {
            settings.value = { ...settings.value, ...result }
            
            if (settings.value.language) {
              applyLocale(settings.value.language)
            }
            
            applyTheme(settings.value.theme || 'system')
          }
          isLoaded.value = true
          resolve()
        }
      })
    } catch (error) {
      console.error('Error loading settings:', error)
      isLoaded.value = true
    }
  }

  // Save settings to IndexedDB
  const saveSettings = async (newSettings: Partial<AppSettings>): Promise<void> => {
    try {
      settings.value = { ...settings.value, ...newSettings }
      
      const db = await initDB()
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      
      return new Promise((resolve, reject) => {
        const request = store.put(toRaw(settings.value), 'app-settings')
        
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve()
      })
    } catch (error) {
      console.error('Error saving settings:', error)
    }
  }

  // Set language
  const setLanguage = async (language: string) => {
    applyLocale(language)
    await saveSettings({ 
      language, 
      isFirstTime: false 
    })
  }

  // Set theme
  const setTheme = async (themeSetting: 'system' | 'light' | 'dark') => {
    applyTheme(themeSetting)
    await saveSettings({ theme: themeSetting })
  }

  // Get available languages
  const getLanguages = () => [
    { title: 'English', value: 'en', flag: '🇺🇸' },
    { title: 'فارسی', value: 'fa', flag: '🇮🇷' }
  ]

  // Get available themes
  const getThemes = () => [
    { title: 'System', value: 'system' },
    { title: 'Light', value: 'light' },
    { title: 'Dark', value: 'dark' }
  ]

  return {
    settings: readonly(settings),
    isLoaded: readonly(isLoaded),
    loadSettings,
    setLanguage,
    setTheme,
    getLanguages,
    getThemes
  }
}
