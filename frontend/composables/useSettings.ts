import { ref, readonly, toRaw } from 'vue'
import { Events } from '@wailsio/runtime'

export type RouteAccuracySetting = 'veryLow' | 'low' | 'medium' | 'high'
export type RouteProtocolSetting = 'tcpUdp' | 'icmp' | 'tcp' | 'udp'
export type RouteIPSetting = 'dualstack' | 'ipv4' | 'ipv6'

interface AppSettings {
  language?: string
  theme?: 'system' | 'light' | 'dark'
  isFirstTime?: boolean
  routeAccuracy?: RouteAccuracySetting
  routeProtocol?: RouteProtocolSetting
  routeIp?: RouteIPSetting
  realtimeOptimization?: boolean
}

const DB_NAME = 'lagzap-settings'
const DB_VERSION = 1
const STORE_NAME = 'settings'

const defaultRoutingSettings = {
  routeAccuracy: 'low' as RouteAccuracySetting,
  routeProtocol: 'tcpUdp' as RouteProtocolSetting,
  routeIp: 'dualstack' as RouteIPSetting,
  realtimeOptimization: true,
}

const settings = ref<AppSettings>({
  language: undefined,
  theme: 'system',
  isFirstTime: true,
  ...defaultRoutingSettings,
})

const isLoaded = ref(false)

const accuracyToEnum: Record<RouteAccuracySetting, number> = {
  veryLow: 0,
  low: 1,
  medium: 2,
  high: 3,
}

const protocolToEnum: Record<RouteProtocolSetting, number> = {
  tcpUdp: 0,
  icmp: 1,
  tcp: 2,
  udp: 3,
}

const ipToEnum: Record<RouteIPSetting, number> = {
  dualstack: 0,
  ipv4: 1,
  ipv6: 2,
}

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

  const applyLocale = (language: string) => {
    try {
      if (locale?.current) {
        locale.current.value = language
      }
    } catch (error) {
      console.warn('Could not apply locale:', error)
    }
  }

  const syncRoutingSettingsToBackend = async () => {
    try {
      const { SetRoutingSettings } = await import('~/bindings/github.com/lagzap/lagzap-desktop/service')
      await SetRoutingSettings(
        accuracyToEnum[settings.value.routeAccuracy ?? 'low'],
        protocolToEnum[settings.value.routeProtocol ?? 'tcpUdp'],
        ipToEnum[settings.value.routeIp ?? 'dualstack'],
        settings.value.realtimeOptimization ?? true,
      )
    } catch (error) {
      console.warn('Could not sync routing settings to backend:', error)
    }
  }

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
          void syncRoutingSettingsToBackend()
          resolve()
        }
      })
    } catch (error) {
      console.error('Error loading settings:', error)
      isLoaded.value = true
    }
  }

  const saveSettings = async (newSettings: Partial<AppSettings>): Promise<void> => {
    try {
      settings.value = { ...settings.value, ...newSettings }
      
      const db = await initDB()
      const transaction = db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      
      return new Promise((resolve, reject) => {
        const request = store.put(toRaw(settings.value), 'app-settings')
        
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          void syncRoutingSettingsToBackend()
          resolve()
        }
      })
    } catch (error) {
      console.error('Error saving settings:', error)
    }
  }

  const setLanguage = async (language: string) => {
    applyLocale(language)
    await saveSettings({ 
      language, 
      isFirstTime: false 
    })
  }

  const setTheme = async (themeSetting: 'system' | 'light' | 'dark') => {
    applyTheme(themeSetting)
    await saveSettings({ theme: themeSetting })
  }

  const setRouteAccuracy = async (routeAccuracy: RouteAccuracySetting) => {
    await saveSettings({ routeAccuracy })
  }

  const setRouteProtocol = async (routeProtocol: RouteProtocolSetting) => {
    await saveSettings({ routeProtocol })
  }

  const setRouteIp = async (routeIp: RouteIPSetting) => {
    await saveSettings({ routeIp })
  }

  const setRealtimeOptimization = async (realtimeOptimization: boolean) => {
    await saveSettings({ realtimeOptimization })
  }

  const getLanguages = () => [
    { title: 'English', value: 'en', flag: '🇺🇸' },
    { title: 'فارسی', value: 'fa', flag: '🇮🇷' }
  ]

  const getThemes = () => [
    { title: 'System', value: 'system' },
    { title: 'Light', value: 'light' },
    { title: 'Dark', value: 'dark' }
  ]

  const getRouteAccuracyOptions = () => [
    { value: 'veryLow' as const },
    { value: 'low' as const },
    { value: 'medium' as const },
    { value: 'high' as const },
  ]

  const getRouteProtocolOptions = () => [
    { value: 'tcpUdp' as const },
    { value: 'icmp' as const },
    { value: 'tcp' as const },
    { value: 'udp' as const },
  ]

  const getRouteIpOptions = () => [
    { value: 'dualstack' as const },
    { value: 'ipv4' as const },
    { value: 'ipv6' as const },
  ]

  return {
    settings: readonly(settings),
    isLoaded: readonly(isLoaded),
    loadSettings,
    setLanguage,
    setTheme,
    setRouteAccuracy,
    setRouteProtocol,
    setRouteIp,
    setRealtimeOptimization,
    syncRoutingSettingsToBackend,
    getLanguages,
    getThemes,
    getRouteAccuracyOptions,
    getRouteProtocolOptions,
    getRouteIpOptions,
  }
}

let routingSyncRegistered = false

export function registerRoutingSettingsSync() {
  if (routingSyncRegistered || typeof window === 'undefined') {
    return
  }
  routingSyncRegistered = true

  Events.On('service-started', () => {
    const { syncRoutingSettingsToBackend } = useSettings()
    void syncRoutingSettingsToBackend()
  })
}
