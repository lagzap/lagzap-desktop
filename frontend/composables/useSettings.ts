import { ref, readonly, shallowRef, toRaw } from 'vue'
import { Events, System } from '@wailsio/runtime'
import type { ThemeInstance } from 'vuetify'
import { ClientSettings } from '~/bindings/github.com/lagzap/zap/data/models'
import {
  GetClientSettings,
  GetInternetPingTarget,
  IsReady,
  SetClientSettings,
  SetInternetPingTarget,
  SetAdapterOrder,
  SetRoutingSettings,
  SetVirtualAdapter,
} from '~/bindings/github.com/lagzap/lagzap-desktop/service'
import { getSettingsValue, putSettingsValue } from '~/utils/settingsDB'

export type RouteAccuracySetting = 'veryLow' | 'low' | 'medium' | 'high'
export type RouteProtocolSetting = 'tcpUdp' | 'icmp' | 'tcp' | 'udp'
export type RouteIPSetting = 'dualstack' | 'ipv4' | 'ipv6'
import { DEFAULT_INTERNET_PING_TARGET, type InternetPingTargetId } from '~/composables/internetPingTargets'

export const MAX_FAVORITE_TITLES = 10
export const MAX_FAVORITE_TICKETS = 10
export const MAX_RECENT_TICKETS = 8

export type AppThemeSetting = 'system' | 'light' | 'dark'

export type RecentTicketEntry = {
  id: string
  visitedAt: number
}

interface AppSettings {
  language?: string
  theme?: AppThemeSetting
  isFirstTime?: boolean
  allowSendDebugInfo?: boolean
  allowSendAnonymousData?: boolean
  launchOnStartup?: boolean
  launchOnStartupMinimize?: boolean
  activeOnStart?: boolean
  gpuAcceleration?: boolean
  routeAccuracy?: RouteAccuracySetting
  routeProtocol?: RouteProtocolSetting
  routeIp?: RouteIPSetting
  realtimeOptimization?: boolean
  proxyDnsRequests?: boolean
  internetPingTarget?: InternetPingTargetId
  relayTransportFallback?: boolean
  /** Show game and app names in English while the UI is in another language. */
  englishTitleNames?: boolean
  /** Windows: capture games through LagZap's virtual adapter instead of the
   * NDIS driver, so adapters can be unplugged or disabled mid-game. */
  virtualAdapter?: boolean
  /** Multi Internet card order: the failover order, Default first. */
  adapterOrder?: string[]
  /** Ordered title IDs for Quick Access favorites (max MAX_FAVORITE_TITLES). */
  favoriteTitleIds?: string[]
  /** Ordered ticket IDs for Quick Access favorites (max MAX_FAVORITE_TICKETS). */
  favoriteTicketIds?: string[]
  /** Recently opened tickets (max MAX_RECENT_TICKETS). */
  recentTickets?: RecentTicketEntry[]
}

const APP_SETTINGS_KEY = 'app-settings'

const defaultRoutingSettings: Required<
  Pick<
    AppSettings,
    | 'routeAccuracy'
    | 'routeProtocol'
    | 'routeIp'
    | 'realtimeOptimization'
    | 'proxyDnsRequests'
    | 'internetPingTarget'
    | 'relayTransportFallback'
  >
> = {
  routeAccuracy: 'low',
  routeProtocol: 'tcpUdp',
  routeIp: 'dualstack',
  realtimeOptimization: true,
  proxyDnsRequests: false,
  internetPingTarget: DEFAULT_INTERNET_PING_TARGET,
  relayTransportFallback: false,
}

const settings = shallowRef<AppSettings>({
  language: undefined,
  theme: 'system',
  isFirstTime: true,
  allowSendDebugInfo: false,
  allowSendAnonymousData: false,
  launchOnStartup: false,
  launchOnStartupMinimize: false,
  activeOnStart: true,
  gpuAcceleration: true,
  favoriteTitleIds: [],
  favoriteTicketIds: [],
  recentTickets: [],
  ...defaultRoutingSettings,
})

const isLoaded = ref(false)
let settingsHydrated = false

function cloneAppSettings(value: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(toRaw(value))) as AppSettings
}

async function persistAppSettings(): Promise<void> {
  await putSettingsValue(APP_SETTINGS_KEY, cloneAppSettings(settings.value))
}

export async function syncThemeFromSetting(
  themeSetting: AppThemeSetting,
  theme?: ThemeInstance
) {
  if (!theme) {
    return
  }
  if (themeSetting === 'system') {
    try {
      const isDark = await System.IsDarkMode()
      theme.change(isDark ? 'dark' : 'light')
      return
    } catch {
      theme.change(
        window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
      )
      return
    }
  }
  theme.change(themeSetting)
}

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
  const applyTheme = (themeSetting: AppThemeSetting) => {
    if (!theme) {
      return
    }
    void syncThemeFromSetting(themeSetting, theme)
  }

  const applyThemeAsync = async (themeSetting: AppThemeSetting) => {
    await syncThemeFromSetting(themeSetting, theme)
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

  const applyClientSettingsFromBackend = (
    clientSettings: ClientSettings,
    options?: { applyUiPrefs?: boolean }
  ) => {
    const applyUiPrefs = options?.applyUiPrefs ?? false
    const patch: Partial<AppSettings> = {}

    if (applyUiPrefs && clientSettings.language) {
      patch.language = clientSettings.language
    }
    if (applyUiPrefs && clientSettings.theme) {
      const theme = clientSettings.theme
      if (theme === 'system' || theme === 'light' || theme === 'dark') {
        patch.theme = theme
      }
    }
    if (applyUiPrefs && clientSettings.allow_send_debug_info !== undefined) {
      patch.allowSendDebugInfo = !!clientSettings.allow_send_debug_info
    }
    if (applyUiPrefs && clientSettings.allow_send_annonymos_data !== undefined) {
      patch.allowSendAnonymousData = !!clientSettings.allow_send_annonymos_data
    }
    if (applyUiPrefs && clientSettings.launch_on_startup !== undefined) {
      patch.launchOnStartup = !!clientSettings.launch_on_startup
    }
    if (applyUiPrefs && clientSettings.launch_on_startup_minimize !== undefined) {
      patch.launchOnStartupMinimize = !!clientSettings.launch_on_startup_minimize
    }
    if (applyUiPrefs && clientSettings.active_on_start !== undefined) {
      patch.activeOnStart = !!clientSettings.active_on_start
    }
    if (applyUiPrefs && clientSettings.gpu_acceleration !== undefined) {
      patch.gpuAcceleration = !!clientSettings.gpu_acceleration
    }
    if (clientSettings.relay_transport_fallback !== undefined) {
      patch.relayTransportFallback = !!clientSettings.relay_transport_fallback
    }
    if (clientSettings.internet_ping_target) {
      patch.internetPingTarget = clientSettings.internet_ping_target as InternetPingTargetId
    }

    if (Object.keys(patch).length > 0) {
      settings.value = { ...settings.value, ...patch }
    }
  }

  const buildClientSettingsPayload = async () => {
    const existing = await GetClientSettings()
    const next = existing ? new ClientSettings(existing) : new ClientSettings()
    if (settings.value.language) {
      next.language = settings.value.language
    }
    if (settings.value.theme) {
      next.theme = settings.value.theme
    }
    next.allow_send_debug_info = settings.value.allowSendDebugInfo ?? false
    next.allow_send_annonymos_data = settings.value.allowSendAnonymousData ?? false
    next.launch_on_startup = settings.value.launchOnStartup ?? false
    next.launch_on_startup_minimize = settings.value.launchOnStartupMinimize ?? false
    next.active_on_start = settings.value.activeOnStart ?? true
    next.gpu_acceleration = settings.value.gpuAcceleration ?? true
    next.relay_transport_fallback = settings.value.relayTransportFallback ?? false
    next.internet_ping_target = settings.value.internetPingTarget ?? DEFAULT_INTERNET_PING_TARGET
    next.proxy_dns_requests = settings.value.proxyDnsRequests ?? false
    next.tcp_routes = existing?.tcp_routes
    next.udp_routes = existing?.udp_routes
    next.default_interface = existing?.default_interface ?? ''
    next.multi_internet_interfaces = existing?.multi_internet_interfaces ?? []
    next.backup_interfaces = existing?.backup_interfaces ?? []
    next.interface_route_settings = existing?.interface_route_settings ?? []
    return next
  }

  const syncRoutingSettingsToBackend = async () => {
    try {
      if (!(await IsReady())) {
        return
      }
      await SetRoutingSettings(
        accuracyToEnum[settings.value.routeAccuracy ?? 'low'],
        protocolToEnum[settings.value.routeProtocol ?? 'tcpUdp'],
        ipToEnum[settings.value.routeIp ?? 'dualstack'],
        settings.value.realtimeOptimization ?? true,
        settings.value.proxyDnsRequests ?? false,
      )
      await SetClientSettings(await buildClientSettingsPayload())
      await SetInternetPingTarget(settings.value.internetPingTarget ?? DEFAULT_INTERNET_PING_TARGET)
      await SetAdapterOrder(settings.value.adapterOrder ?? [])
    } catch (error) {
      console.warn('Could not sync routing settings to backend:', error)
    }
  }

  const applyPresentation = async () => {
    if (settings.value.language) {
      applyLocale(settings.value.language)
    }

    if (theme) {
      await applyThemeAsync(settings.value.theme || 'system')
    } else {
      applyTheme(settings.value.theme || 'system')
    }
  }

  const loadSettings = async (): Promise<void> => {
    if (settingsHydrated) {
      await applyPresentation()
      return
    }

    try {
      const result = await getSettingsValue<AppSettings>(APP_SETTINGS_KEY)

      const hadLocalPrefs = !!result
      if (result) {
        settings.value = { ...settings.value, ...result }
      }

      try {
        const backendSettings = await GetClientSettings()
        if (backendSettings) {
          applyClientSettingsFromBackend(backendSettings, {
            applyUiPrefs: !hadLocalPrefs,
          })
        }
        const pingTarget = await GetInternetPingTarget()
        if (pingTarget) {
          settings.value = {
            ...settings.value,
            internetPingTarget: pingTarget as InternetPingTargetId,
          }
        }
      } catch (error) {
        console.warn('Could not load client settings from backend:', error)
      }

      if (!hadLocalPrefs) {
        await persistAppSettings()
      }

      settingsHydrated = true
      isLoaded.value = true
      await applyPresentation()
    } catch (error) {
      console.error('Error loading settings:', error)
      settingsHydrated = true
      isLoaded.value = true
    }
  }

  const saveSettings = async (newSettings: Partial<AppSettings>): Promise<void> => {
    settings.value = { ...settings.value, ...newSettings }
    try {
      await persistAppSettings()
      void syncRoutingSettingsToBackend()
    } catch (error) {
      console.error('Error saving settings:', error)
      throw error
    }
  }

  const setLanguage = async (language: string) => {
    applyLocale(language)
    await saveSettings({
      language,
      isFirstTime: false,
    })
  }

  const setTheme = async (themeSetting: 'system' | 'light' | 'dark') => {
    applyTheme(themeSetting)
    await saveSettings({ theme: themeSetting })
    Events.Emit('app-theme-changed', themeSetting)
  }

  const setAllowSendDebugInfo = async (allowSendDebugInfo: boolean) => {
    await saveSettings({ allowSendDebugInfo })
  }

  const setAllowSendAnonymousData = async (allowSendAnonymousData: boolean) => {
    await saveSettings({ allowSendAnonymousData })
  }

  const setLaunchOnStartup = async (launchOnStartup: boolean) => {
    const patch: Partial<AppSettings> = { launchOnStartup }
    if (!launchOnStartup) {
      patch.launchOnStartupMinimize = false
    }
    await saveSettings(patch)
  }

  const setLaunchOnStartupMinimize = async (launchOnStartupMinimize: boolean) => {
    await saveSettings({ launchOnStartupMinimize })
  }

  const setActiveOnStart = async (activeOnStart: boolean) => {
    await saveSettings({ activeOnStart })
  }

  const setGpuAcceleration = async (gpuAcceleration: boolean) => {
    await saveSettings({ gpuAcceleration })
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

  const setProxyDnsRequests = async (proxyDnsRequests: boolean) => {
    await saveSettings({ proxyDnsRequests })
  }

  const setRelayTransportFallback = async (relayTransportFallback: boolean) => {
    await saveSettings({ relayTransportFallback })
  }

  const setEnglishTitleNames = async (englishTitleNames: boolean) => {
    await saveSettings({ englishTitleNames })
  }

  /** Saving also syncs it to the backend (syncRoutingSettingsToBackend). */
  const setAdapterOrder = async (adapterOrder: string[]) => {
    await saveSettings({ adapterOrder })
  }

  /** Switches capture mode now; a TUN start failure leaves NDIS running and
   * the setting off. */
  const setVirtualAdapter = async (virtualAdapter: boolean) => {
    try {
      await SetVirtualAdapter(virtualAdapter)
    } catch (error) {
      await saveSettings({ virtualAdapter: false })
      throw error
    }
    await saveSettings({ virtualAdapter })
  }

  const setInternetPingTarget = async (internetPingTarget: InternetPingTargetId) => {
    try {
      await SetInternetPingTarget(internetPingTarget)
    } catch (error) {
      console.warn('Could not set internet ping target:', error)
    }
    await saveSettings({ internetPingTarget })
  }

  const normalizeFavoriteTitleIds = (ids: string[]): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const id of ids) {
      if (!id || seen.has(id)) {
        continue
      }
      seen.add(id)
      out.push(id)
      if (out.length >= MAX_FAVORITE_TITLES) {
        break
      }
    }
    return out
  }

  const setFavoriteTitleIds = async (favoriteTitleIds: string[]) => {
    await saveSettings({
      favoriteTitleIds: normalizeFavoriteTitleIds(favoriteTitleIds),
    })
  }

  const normalizeFavoriteTicketIds = (ids: string[]): string[] => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const id of ids) {
      if (!id || seen.has(id)) {
        continue
      }
      seen.add(id)
      out.push(id)
      if (out.length >= MAX_FAVORITE_TICKETS) {
        break
      }
    }
    return out
  }

  const setFavoriteTicketIds = async (favoriteTicketIds: string[]) => {
    await saveSettings({
      favoriteTicketIds: normalizeFavoriteTicketIds(favoriteTicketIds),
    })
  }

  const normalizeRecentTickets = (
    entries: RecentTicketEntry[],
  ): RecentTicketEntry[] => {
    const seen = new Set<string>()
    const out: RecentTicketEntry[] = []
    const sorted = [...entries].sort((a, b) => b.visitedAt - a.visitedAt)
    for (const entry of sorted) {
      if (!entry?.id || seen.has(entry.id)) {
        continue
      }
      seen.add(entry.id)
      out.push({
        id: entry.id,
        visitedAt: Number(entry.visitedAt) || Date.now(),
      })
      if (out.length >= MAX_RECENT_TICKETS) {
        break
      }
    }
    return out
  }

  const setRecentTickets = async (recentTickets: RecentTicketEntry[]) => {
    await saveSettings({
      recentTickets: normalizeRecentTickets(recentTickets),
    })
  }

  const touchRecentTicket = async (ticketId: string) => {
    if (!ticketId) {
      return
    }
    const next = [
      { id: ticketId, visitedAt: Date.now() },
      ...(settings.value.recentTickets ?? []).filter(
        (entry) => entry.id !== ticketId,
      ),
    ]
    await setRecentTickets(next)
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
    setAllowSendDebugInfo,
    setAllowSendAnonymousData,
    setLaunchOnStartup,
    setLaunchOnStartupMinimize,
    setActiveOnStart,
    setGpuAcceleration,
    setRouteAccuracy,
    setRouteProtocol,
    setRouteIp,
    setRealtimeOptimization,
    setProxyDnsRequests,
    setRelayTransportFallback,
    setEnglishTitleNames,
    setVirtualAdapter,
    setAdapterOrder,
    setInternetPingTarget,
    setFavoriteTitleIds,
    setFavoriteTicketIds,
    setRecentTickets,
    touchRecentTicket,
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

  Events.On('service-started', async () => {
    if (!(await IsReady())) {
      return
    }
    const { syncRoutingSettingsToBackend } = useSettings()
    void syncRoutingSettingsToBackend()
  })
}
