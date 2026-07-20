import { computed, onMounted, ref, watch } from 'vue'
import { Events } from '@wailsio/runtime'
import { GetClientSettings, SetClientSettings } from '~/bindings/github.com/lagzap/lagzap-desktop/service'
import { ClientSettings, InterfaceRouteSettings } from '~/bindings/github.com/lagzap/zap/data/models'
import {
  DEFAULT_TCP_ROUTES,
  DEFAULT_UDP_ROUTES,
  normalizeRouteCounts,
  type RouteCountPair,
} from '~/composables/routeCountUtils'
import {
  getSettingsValue,
  putSettingsValue,
} from '~/utils/settingsDB'

const NETWORK_SETTINGS_KEY = 'network-adapter-settings'

interface StoredNetworkAdapterSettings {
  defaultInterface: string | null
  multiInternetInterfaces: string[]
  multiInternetExplicit?: boolean
  backupInterfaces: string[]
  backupInterfacesExplicit?: boolean
  globalTcpRoutes: number | null
  globalUdpRoutes: number | null
  interfaceRouteOverrides: Record<string, RouteCountPair>
}

const defaultInterfaceOverride = ref<string | null>(null)
const multiInternetNames = ref<string[]>([])
const multiInternetExplicit = ref(false)
const backupInterfaceNames = ref<string[]>([])
const backupInterfacesExplicit = ref(false)
const globalTcpRoutes = ref<number | null>(null)
const globalUdpRoutes = ref<number | null>(null)
const interfaceRouteOverrides = ref<Record<string, RouteCountPair>>({})
const loaded = ref(false)
const saving = ref(false)
let syncRegistered = false

async function loadStoredSettings(): Promise<StoredNetworkAdapterSettings | null> {
  return (await getSettingsValue<StoredNetworkAdapterSettings>(NETWORK_SETTINGS_KEY)) ?? null
}

async function saveStoredSettings(value: StoredNetworkAdapterSettings): Promise<void> {
  await putSettingsValue(NETWORK_SETTINGS_KEY, value)
}

function applySettingsFromBackend(settings: ClientSettings) {
  const iface = settings.default_interface ?? ''
  defaultInterfaceOverride.value = iface === '' ? null : iface
  multiInternetNames.value = settings.multi_internet_interfaces ?? []
  multiInternetExplicit.value = (settings.multi_internet_interfaces?.length ?? 0) > 0
  backupInterfaceNames.value = settings.backup_interfaces ?? []
  backupInterfacesExplicit.value = (settings.backup_interfaces?.length ?? 0) > 0
  globalTcpRoutes.value =
    settings.tcp_routes === undefined || settings.tcp_routes === null ? null : settings.tcp_routes
  globalUdpRoutes.value =
    settings.udp_routes === undefined || settings.udp_routes === null ? null : settings.udp_routes

  const overrides: Record<string, RouteCountPair> = {}
  for (const row of settings.interface_route_settings ?? []) {
    if (!row?.interface) {
      continue
    }
    overrides[row.interface] = {
      tcp: row.tcp_routes ?? null,
      udp: row.udp_routes ?? null,
    }
  }
  interfaceRouteOverrides.value = overrides
}

function buildInterfaceRouteSettingsPayload(): InterfaceRouteSettings[] {
  return Object.entries(interfaceRouteOverrides.value)
    .filter(([, row]) => row.tcp !== null || row.udp !== null)
    .map(([iface, row]) =>
      new InterfaceRouteSettings({
        interface: iface,
        tcp_routes: row.tcp,
        udp_routes: row.udp,
      }),
    )
}

async function syncToBackend() {
  if (!loaded.value || saving.value) {
    return
  }
  saving.value = true
  try {
    const existing = await GetClientSettings()
    const next = existing ? new ClientSettings(existing) : new ClientSettings()
    next.default_interface = defaultInterfaceOverride.value ?? ''
    next.multi_internet_interfaces =
      !multiInternetExplicit.value || multiInternetNames.value.length === 0
        ? []
        : [...multiInternetNames.value]
    next.backup_interfaces =
      !backupInterfacesExplicit.value || backupInterfaceNames.value.length === 0
        ? []
        : [...backupInterfaceNames.value]
    next.tcp_routes = globalTcpRoutes.value ?? DEFAULT_TCP_ROUTES
    next.udp_routes = globalUdpRoutes.value ?? DEFAULT_UDP_ROUTES
    next.interface_route_settings = buildInterfaceRouteSettingsPayload()
    await SetClientSettings(next)
    await saveStoredSettings({
      defaultInterface: defaultInterfaceOverride.value,
      multiInternetInterfaces: [...multiInternetNames.value],
      multiInternetExplicit: multiInternetExplicit.value,
      backupInterfaces: [...backupInterfaceNames.value],
      backupInterfacesExplicit: backupInterfacesExplicit.value,
      globalTcpRoutes: globalTcpRoutes.value,
      globalUdpRoutes: globalUdpRoutes.value,
      interfaceRouteOverrides: { ...interfaceRouteOverrides.value },
    })
  } catch (error) {
    console.warn('Could not save network adapter settings:', error)
  } finally {
    saving.value = false
  }
}

async function loadNetworkAdapterSettings() {
  try {
    const stored = await loadStoredSettings()
    if (stored) {
      defaultInterfaceOverride.value = stored.defaultInterface
      multiInternetNames.value = stored.multiInternetInterfaces ?? []
      multiInternetExplicit.value = stored.multiInternetExplicit ?? false
      backupInterfaceNames.value = stored.backupInterfaces ?? []
      backupInterfacesExplicit.value = stored.backupInterfacesExplicit ?? false
      globalTcpRoutes.value = stored.globalTcpRoutes ?? null
      globalUdpRoutes.value = stored.globalUdpRoutes ?? null
      interfaceRouteOverrides.value = stored.interfaceRouteOverrides ?? {}
    } else {
      const settings = await GetClientSettings()
      if (settings) {
        applySettingsFromBackend(settings)
      }
    }
    loaded.value = true
    await syncToBackend()
  } catch (error) {
    console.warn('Could not load network adapter settings:', error)
    loaded.value = true
  }
}

export function useNetworkAdapterSettings() {
  const store = useStore()

  const interfaceNames = computed(() =>
    store.interfaces.map((iface) => iface.Name).filter(Boolean),
  )

  const multiInternetSelection = computed({
    get() {
      const all = interfaceNames.value
      if (!multiInternetExplicit.value) {
        return all
      }
      return multiInternetNames.value.filter((name) => all.includes(name))
    },
    set(value: string[] | null | undefined) {
      const all = interfaceNames.value
      const unique = [...new Set(value ?? [])]

      if (unique.length === 0) {
        multiInternetExplicit.value = true
        multiInternetNames.value = []
      } else if (
        all.length > 0 &&
        unique.length === all.length &&
        all.every((name) => unique.includes(name))
      ) {
        multiInternetExplicit.value = false
        multiInternetNames.value = []
      } else {
        multiInternetExplicit.value = true
        multiInternetNames.value = unique
      }
      void syncToBackend()
    },
  })

  const backupInterfacesSelection = computed({
    get() {
      const all = interfaceNames.value
      if (!backupInterfacesExplicit.value) {
        return all
      }
      return backupInterfaceNames.value.filter((name) => all.includes(name))
    },
    set(value: string[] | null | undefined) {
      const all = interfaceNames.value
      const unique = [...new Set(value ?? [])]

      if (unique.length === 0) {
        backupInterfacesExplicit.value = true
        backupInterfaceNames.value = []
      } else if (
        all.length > 0 &&
        unique.length === all.length &&
        all.every((name) => unique.includes(name))
      ) {
        backupInterfacesExplicit.value = false
        backupInterfaceNames.value = []
      } else {
        backupInterfacesExplicit.value = true
        backupInterfaceNames.value = unique
      }
      void syncToBackend()
    },
  })

  const routeTableInterfaces = computed(() => {
    if (!multiInternetExplicit.value) {
      return interfaceNames.value
    }
    return multiInternetNames.value.filter((name) => interfaceNames.value.includes(name))
  })

  const resolvedGlobalTcp = computed(() => globalTcpRoutes.value ?? DEFAULT_TCP_ROUTES)
  const resolvedGlobalUdp = computed(() => globalUdpRoutes.value ?? DEFAULT_UDP_ROUTES)

  function effectiveTcpForInterface(name: string) {
    const row = interfaceRouteOverrides.value[name]
    if (row?.tcp !== null && row?.tcp !== undefined) {
      return row.tcp
    }
    return resolvedGlobalTcp.value
  }

  function effectiveUdpForInterface(name: string) {
    const row = interfaceRouteOverrides.value[name]
    if (row?.udp !== null && row?.udp !== undefined) {
      return row.udp
    }
    return resolvedGlobalUdp.value
  }

  function getInterfaceRouteOverride(name: string): RouteCountPair {
    return interfaceRouteOverrides.value[name] ?? { tcp: null, udp: null }
  }

  function setGlobalTcp(value: number | null) {
    if (value === null) {
      globalTcpRoutes.value = null
    } else {
      const normalized = normalizeRouteCounts(
        value,
        globalUdpRoutes.value ?? DEFAULT_UDP_ROUTES,
        'tcp',
      )
      globalTcpRoutes.value = normalized.tcp
      if (globalUdpRoutes.value !== null && normalized.udp !== null) {
        globalUdpRoutes.value = normalized.udp
      }
    }
    void syncToBackend()
  }

  function setGlobalUdp(value: number | null) {
    if (value === null) {
      globalUdpRoutes.value = null
    } else {
      const normalized = normalizeRouteCounts(
        globalTcpRoutes.value ?? DEFAULT_TCP_ROUTES,
        value,
        'udp',
      )
      globalUdpRoutes.value = normalized.udp
      if (globalTcpRoutes.value !== null && normalized.tcp !== null) {
        globalTcpRoutes.value = normalized.tcp
      }
    }
    void syncToBackend()
  }

  function setInterfaceTcp(name: string, value: number | null) {
    const current = getInterfaceRouteOverride(name)
    if (value === null) {
      const next = { ...current, tcp: null }
      if (next.tcp === null && next.udp === null) {
        const { [name]: _, ...rest } = interfaceRouteOverrides.value
        interfaceRouteOverrides.value = rest
      } else {
        interfaceRouteOverrides.value = { ...interfaceRouteOverrides.value, [name]: next }
      }
    } else {
      const normalized = normalizeRouteCounts(
        value,
        current.udp ?? effectiveUdpForInterface(name),
        'tcp',
      )
      interfaceRouteOverrides.value = {
        ...interfaceRouteOverrides.value,
        [name]: {
          tcp: normalized.tcp,
          udp: current.udp,
        },
      }
    }
    void syncToBackend()
  }

  function setInterfaceUdp(name: string, value: number | null) {
    const current = getInterfaceRouteOverride(name)
    if (value === null) {
      const next = { ...current, udp: null }
      if (next.tcp === null && next.udp === null) {
        const { [name]: _, ...rest } = interfaceRouteOverrides.value
        interfaceRouteOverrides.value = rest
      } else {
        interfaceRouteOverrides.value = { ...interfaceRouteOverrides.value, [name]: next }
      }
    } else {
      const normalized = normalizeRouteCounts(
        current.tcp ?? effectiveTcpForInterface(name),
        value,
        'udp',
      )
      interfaceRouteOverrides.value = {
        ...interfaceRouteOverrides.value,
        [name]: {
          tcp: current.tcp,
          udp: normalized.udp,
        },
      }
    }
    void syncToBackend()
  }

  watch(defaultInterfaceOverride, () => {
    void syncToBackend()
  })

  onMounted(() => {
    if (!loaded.value) {
      void loadNetworkAdapterSettings()
    }
    void store.updateInterfaces()
  })

  return {
    defaultInterfaceOverride,
    multiInternetSelection,
    backupInterfacesSelection,
    loaded,
    ensureLoaded: () => {
      if (!loaded.value) {
        return loadNetworkAdapterSettings()
      }
      return Promise.resolve()
    },
    refreshInterfaces: store.updateInterfaces,
    defaultInterface: computed(() => store.defaultInterface),
    interfaces: computed(() => store.interfaces),
    routeTableInterfaces,
    globalTcpRoutes,
    globalUdpRoutes,
    resolvedGlobalTcp,
    resolvedGlobalUdp,
    getInterfaceRouteOverride,
    effectiveTcpForInterface,
    effectiveUdpForInterface,
    setGlobalTcp,
    setGlobalUdp,
    setInterfaceTcp,
    setInterfaceUdp,
  }
}

export function registerNetworkAdapterSettingsSync() {
  if (syncRegistered || typeof window === 'undefined') {
    return
  }
  syncRegistered = true

  Events.On('service-started', () => {
    void syncToBackend()
  })
}
