import { defineStore } from "pinia";
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  IsProxyRunning,
  IsRunning,
  StartProxy,
  StopProxy,
  SaveTitleState,
  GetRoutes,
  TestSpecificNode,
  SaveProfileState,
  Status,
  SetAccessToken,
  SetEndpoints,
  SetLogLevel,
  Connect,
  Disconnect,
  GetTitleStates,
  ClearDNSCache,
  VisitTitle,
  GetInterfaces,
  GetClientInfo,
  CancelConnect,
  StopService,
  StopLocalProxy,
  StartBootstrapLocalProxy,
  GetOptimizeProgress,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import {
  type RelayRoute,
  type Profile,
  type ProfileState,
  type Region,
  type Title,
  type TitleState,
  type Node,
  type Latency,
  Optimize,
  ClientInfo,
} from "~/bindings/github.com/lagzap/zap/data";
import { Events } from "@wailsio/runtime";
import { displayError } from "~/composables/alert";
import { getToken } from "~/utils/indexedDB";
import { clearAuthSession } from "~/composables/useAuthSession";
import { useMonitoringStore } from "~/stores/monitoring";
import { useLocale } from "vuetify";
import { ConnectionStatus } from "~/constants/status";
import type { Interface } from "~/bindings/github.com/lagzap/zap/common/control";
import type { MultiInterfaceLatency } from "~/composables/useLatencyMetrics";
import {
  mergeLatencyPingCache,
  type LatencyPingCache,
} from "~/composables/pingChartCache";
import { PING_RAW_CAP } from "~/constants/pingChart";

export const useStore = defineStore("index", () => {
  const locale = useLocale();
  // State
  const status = ref<ConnectionStatus>(ConnectionStatus.StatusDisconnected);
  const abilities = ref<string[]>([]);
  const displayLimit = ref<number>(10);
  const loading = ref<boolean>(false);
  const connecting = ref<boolean>(false);
  const startupCanceled = ref<boolean>(false);
  const statusMessage = ref<string>(locale.t("$vuetify.service.initializing"));
  const error = ref<boolean>(false);
  const optimizeProgress = ref<Optimize | null>(null);
  const optimizeMinimized = ref(false);
  const serviceReady = ref<boolean>(false);
  const appReady = ref<boolean>(false);
  const ndisRunning = ref<boolean>(false);
  const latency = ref<MultiInterfaceLatency | null>(null);
  const latencyPingCache = ref<LatencyPingCache>({ byInterface: {} });

  const titles = ref<Title[]>([]);
  const profiles = ref<Profile[]>([]);
  const regions = ref<Record<string, Region>>({});
  const nodes = ref<Record<string, Node>>({});
  const titleStates = ref<Record<string, TitleState>>({});
  const profileStates = ref<Record<string, ProfileState>>({});
  const routes = ref<Record<string, RelayRoute>>({});
  const clientInfo = ref<ClientInfo | null>(null);

  const defaultInterface = ref<string | null>(null);
  const interfaces = ref<Interface[]>([]);
  const profileUnavailableInterfaces = ref<Record<string, string[]>>({});

  // Getters
  const isReady = computed(() => serviceReady.value);
  const online = computed(
    () => status.value == ConnectionStatus.StatusConnected
  );
  const connected = online;
  const usable = computed(() => appReady.value);
  const internetStatus = computed(() => {
    if (online.value) {
      return "online" as const;
    }
    if (status.value === ConnectionStatus.StatusReconnecting) {
      return "reconnecting" as const;
    }
    if (appReady.value) {
      return "offline" as const;
    }
    return "unavailable" as const;
  });
  const optimizing = computed(
    () => optimizeProgress.value !== null && !optimizeProgress.value.is_complete
  );

  const getTitles = computed((): Title[] => {
    const activeTitles = titles.value
      .filter((title) => titleStates.value[title.id]?.active === true)
      .sort(
        (a, b) =>
          (titleStates.value[b.id]?.visited_at || 0) - (titleStates.value[a.id]?.visited_at || 0)
      );
    const inactiveTitles = titles.value
      .filter((title) => titleStates.value[title.id]?.active !== true)
      .sort(
        (a, b) =>
          (titleStates.value[b.id]?.visited_at || 0) - (titleStates.value[a.id]?.visited_at || 0)
      );
    return [...activeTitles, ...inactiveTitles];
  });

  const getRecentTitles = computed((): Title[] => {
    const activeTitles = titles.value
      .filter((title) => titleStates.value[title.id]?.active === true)
      .sort(
        (a, b) =>
          (titleStates.value[b.id]?.visited_at || 0) - (titleStates.value[a.id]?.visited_at || 0)
      );
    
    const inactiveTitles = titles.value
      .filter((title) => titleStates.value[title.id]?.active !== true)
      .sort(
        (a, b) =>
          (titleStates.value[b.id]?.visited_at || 0) - (titleStates.value[a.id]?.visited_at || 0)
      )
      .slice(0, 5);

    const titlesArray = [...activeTitles, ...inactiveTitles];
    return titlesArray;
  });

  const waitForOptimizeComplete = async (timeoutMs = 180_000) => {
    const deadline = Date.now() + timeoutMs;
    let graceUntil = Date.now() + 3_000;

    while (Date.now() < deadline) {
      if (startupCanceled.value) {
        return;
      }

      let progress: Optimize | null = null;
      try {
        progress = await GetOptimizeProgress();
      } catch {
        progress = null;
      }

      if (progress) {
        optimizeProgress.value = progress;
        graceUntil = 0;
        if (progress.is_complete) {
          await new Promise((resolve) => setTimeout(resolve, 900));
          return;
        }
      } else if (graceUntil > 0 && Date.now() > graceUntil) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };

  const initialize = async (callback?: () => void) => {
    if (startupCanceled.value) {
      return;
    }
    loading.value = true;
    error.value = false;

    try {
      statusMessage.value = locale.t("$vuetify.service.preparing");
      await check();
      if (startupCanceled.value) {
        return;
      }

      await check();
      if (!connected.value) {
        await connect();
      }
      if (startupCanceled.value) {
        return;
      }

      await waitForOptimizeComplete();
      if (startupCanceled.value) {
        return;
      }

      if (optimizeProgress.value) {
        statusMessage.value = `${optimizeProgress.value.completed_tests || 0} / ${optimizeProgress.value.total_tests || 0}`;
      }
      await nextTick();
      await StartProxy();
      await check();
      await ClearDNSCache();

      statusMessage.value = locale.t("$vuetify.service.ready");
      appReady.value = true;
      if (callback !== undefined) {
        callback();
      }
    } catch (err) {
      if (startupCanceled.value) {
        return;
      }
      console.dir(err);

      error.value = true;
      throw err;
    } finally {
      loading.value = false;
    }
  };

  const restoreAfterReload = async () => {
    if (appReady.value || startupCanceled.value) {
      return;
    }
    const route = useRoute();
    if (
      route.path.startsWith("/start-service") ||
      route.path.startsWith("/auth") ||
      route.path.startsWith("/latency-overlay")
    ) {
      return;
    }
    await check();
    if (!serviceReady.value) {
      return;
    }
    try {
      await initialize();
    } catch (err) {
      console.error("Failed to restore session after reload:", err);
    }
  };

  // Setup event listeners
  onMounted(async () => {
    let unavailableIfaceTimer: ReturnType<typeof setTimeout> | null = null;
    await check();
    Events.On("status", ({ data }) => (status.value = data));
    Events.On("service-started", async () => await check());
    Events.On("service-stopped", async () => {
      appReady.value = false;
      await check();
    });
    Events.On("titles", ({ data }) => upsertTitles(data));
    Events.On("title-delete", ({ data }) => deleteTitle(data));
    Events.On("profiles", ({ data }) => upsertProfiles(data));
    Events.On("profile-delete", ({ data }) => deleteProfile(data));
    Events.On("title_states", ({ data }) => upsertTitleStates(data));
    Events.On("profile_states", ({ data }) => upsertProfileStates(data));
    Events.On("client_info", ({ data }) => {
      clientInfo.value = data;
    });
    Events.On("regions", ({ data }) => upsertRegions(data));
    Events.On("region-delete", ({ data }) => deleteRegion(data));
    Events.On("nodes", ({ data }) => upsertNodes(data));
    Events.On("node-delete", ({ data }) => deleteNode(data));
    Events.On("relay-routes", ({ data }) => {
      routes.value = {
        ...routes.value,
        ...(data as Record<string, RelayRoute>),
      };
    });
    Events.On("optimize", async ({ data }) => {
      // Ignore stale in-flight updates that race after completion and leave
      // the UI stuck at 99% with is_complete=false.
      if (
        optimizeProgress.value?.is_complete &&
        data &&
        !data.is_complete &&
        (data.progress ?? 0) > 0
      ) {
        return;
      }
      optimizeProgress.value = data;
      if (data?.is_complete) {
        optimizeMinimized.value = false;
        statusMessage.value = `${data.completed_tests || 0} / ${data.total_tests || 0}`;
        // Dismiss the panel shortly after completion.
        window.setTimeout(() => {
          if (optimizeProgress.value?.is_complete) {
            optimizeProgress.value = null;
          }
        }, 900);
        return;
      }
      if (data) {
        statusMessage.value = `${data.completed_tests || 0} / ${data.total_tests || 0}`;
      }
    });
    Events.On("interfaces-updated", async ({ data }) => {
      await updateInterfaces()
    });
    Events.On("route-probe", () => {
      // Probes arrive ~2/sec for game routes — debounce iface availability
      // so we do not recompute every profile on every tick.
      if (unavailableIfaceTimer != null) {
        return;
      }
      unavailableIfaceTimer = setTimeout(() => {
        unavailableIfaceTimer = null;
        Object.keys(profileStates.value).forEach((profileId) => {
          updateProfileUnavailableInterfaces(profileId);
        });
      }, 1000);
    });

    const { user, isAuthenticated, init: sanctumInit } = useSanctumAuth<DataResponse>();
    if (!isAuthenticated.value) {
      const token = await getToken("lz.access_token");
      if (!token) {
        return;
      }
      try {
        await sanctumInit();
      } catch {
        await clearAuthSession();
        return;
      }
    }
    const { log_level } = user.value;
    abilities.value = user.value.abilities || [];
    SetLogLevel(log_level);

    await restoreAfterReload();
  });

  onUnmounted(() => {
    Events.OffAll();
  })

  const updateInterfaces = async () => {
    const [newDefaultInterface, newInterfaces] = await GetInterfaces()
    if (newDefaultInterface === null || newInterfaces === null) {
      return;
    }
    defaultInterface.value = newDefaultInterface.Name;
    interfaces.value = newInterfaces;
    
    // Update unavailable interfaces for all profiles
    Object.keys(profileStates.value).forEach(profileId => {
      updateProfileUnavailableInterfaces(profileId);
    });
  };

  const toggleTitleState = async (title: Title) => {
    if (isTitleActive(title.id)) {
      await deactivateTitle(title.id);
    } else {
      await activateTitle(title.id);
    }
  };
  const toggleProfileState = async (profile: Profile) => {
    if (isProfileActive(profile.id)) {
      await deactivateProfile(profile.id);
    } else {
      await activateProfile(profile.id);
    }
  };
  const setDisplayLimit = (limit: number) => {
    displayLimit.value = limit;
  };
  const isTitleActive = (id: string): boolean => {
    return titleStates.value[id]?.active === true;
  };
  const isProfileActive = (profileId: string): boolean => {
    return (
      profileStates.value[profileId] !== undefined &&
      profileStates.value[profileId].active
    );
  };
  const activateTitle = async (id: string) => {
    if (!titleStates.value[id]) {
      titleStates.value = await GetTitleStates()
    }
    titleStates.value[id].active = true;
    saveTitleState(id);
  };
  const deactivateTitle = async (id: string) => {
    if (!titleStates.value[id]) {
      titleStates.value = await GetTitleStates()
    }
    titleStates.value[id].active = false;
    saveTitleState(id);
  };
  const saveTitleState = async (id: string) => {
    try {
      await SaveTitleState(titleStates.value[id]);
    } catch (e) {
      displayError(e, locale);
    }
  };
  const activateProfile = async (profileId: string) => {
    if (profileStates.value[profileId]) {
      profileStates.value[profileId].active = true;
    }
    await saveProfileState(profileId);
  };
  const deactivateProfile = async (profileId: string) => {
    if (profileStates.value[profileId]) {
      profileStates.value[profileId].active = false;
    }
    await saveProfileState(profileId);
  };
  const saveProfileState = async (profileId: string) => {
    try {
      await SaveProfileState(profileStates.value[profileId]);
    } catch (e) {
      displayError(e, locale);
    }
  };
  const visitTitle = async (id: string) => {
    await VisitTitle(id);
    titleStates.value[id].visited_at = Date.now();
  };

  const upsertTitles = (titlesArray: Title[]) => {
    if (!Array.isArray(titlesArray)) return;
    for (const title of titlesArray) {
      const existingIndex = titles.value.findIndex((t) => t.id === title.id);
      if (existingIndex !== -1) {
        titles.value[existingIndex] = title;
      } else {
        titles.value.push(title);
      }
    }
  };
  const upsertProfiles = (profilesArray: Profile[]) => {
    if (!Array.isArray(profilesArray)) return;
    for (const profile of profilesArray) {
      const existingIndex = profiles.value.findIndex(
        (p) => p.id === profile.id
      );
      if (existingIndex !== -1) {
        profiles.value[existingIndex] = profile;
      } else {
        profiles.value.push(profile);
      }
    }
  };
  const upsertTitleStates = (states: Record<string, TitleState>) => {
    if (!states) return;
    for (const titleState of Object.values(states)) {
      titleStates.value[titleState.titleId] = titleState;
    }
  };
  const upsertProfileStates = (states: Record<string, ProfileState>) => {
    if (!states) return;
    for (const profileState of Object.values(states)) {
      profileStates.value[profileState.profileId] = profileState;
      updateProfileUnavailableInterfaces(profileState.profileId);
    }
  };
  const upsertRegions = (newRegions: Region[]) => {
    if (!Array.isArray(newRegions)) return;
    newRegions.forEach((region) => {
      regions.value[region.tag] = region;
    });
  };
  const upsertNodes = (newNodes: Node[]) => {
    if (!Array.isArray(newNodes)) return;
    newNodes.forEach((node) => {
      nodes.value[node.id] = node;
    });
    updateEcho();
  };
  const deleteTitle = (id: string) => {
    const titleIndex = titles.value.findIndex((title) => title.id === id);
    if (titleIndex !== -1) {
      titles.value.splice(titleIndex, 1);

      const associatedProfileIndices = profiles.value
        .map((profile, index) => (profile.title_id === id ? index : -1))
        .filter((index) => index !== -1)
        .reverse();

      for (const index of associatedProfileIndices) {
        profiles.value.splice(index, 1);
      }
    }
  };
  const deleteProfile = (id: string) => {
    const profileIndex = profiles.value.findIndex(
      (profile) => profile.id === id
    );
    if (profileIndex !== -1) {
      profiles.value.splice(profileIndex, 1);
    }
  };
  const deleteRegion = (tag: string) => {
    delete regions.value[tag];
  };
  const deleteNode = (id: string) => {
    delete nodes.value[id];
    delete routes.value[id];
  };
  const findTitleByRuleTag = (rule_tag: string): Title | undefined => {
    const profileEntry = profiles.value.find(
      (profile) => profile.id === rule_tag
    );
    if (!profileEntry) return undefined;
    return titles.value.find((title) => title.id === profileEntry.title_id);
  };
  const findProfileByRuleTag = (rule_tag: string): Profile | undefined => {
    return profiles.value.find((profile) => profile.id === rule_tag);
  };
  const check = async () => {
    serviceReady.value = await IsRunning();
    ndisRunning.value = await IsProxyRunning();
    status.value = await Status();
    clientInfo.value = await GetClientInfo();
  };
  const connect = async () => {
    if (startupCanceled.value) {
      return;
    }
    connecting.value = true;
    statusMessage.value = locale.t("$vuetify.service.connecting");
    await updateInterfaces();
    await check();
    if (connected.value) {
      connecting.value = false;
      loading.value = false;
      return;
    }
    if (startupCanceled.value) {
      connecting.value = false;
      return;
    }
    statusMessage.value = locale.t("$vuetify.service.fetchingData");

    try {
      const { user, isAuthenticated } = useSanctumAuth<DataResponse>();
      if (!isAuthenticated) {
        return;
      }
      const { endpoints, log_level } = user.value;
      abilities.value = user.value.abilities || [];
      const accessToken = (await getToken("lz.access_token")) ?? "";
      await SetAccessToken(accessToken);
      await SetEndpoints(endpoints);
      await SetLogLevel(log_level);
      if (startupCanceled.value) {
        return;
      }
      await Connect();
      if (startupCanceled.value) {
        return;
      }
      await check();
    } catch (e) {
      if (startupCanceled.value) {
        return;
      }
      error.value = true;
      statusMessage.value = e.message;

      console.error(e);
      throw e;
    } finally {
      connecting.value = false;
      await check();
    }
  };

  const resetStartupCancel = () => {
    startupCanceled.value = false;
  };

  const resetToPreStartup = async () => {
    startupCanceled.value = false;
    connecting.value = false;
    error.value = false;
    appReady.value = false;
    optimizeProgress.value = null;
    optimizeMinimized.value = false;

    try {
      await CancelConnect();
    } catch {
      // ignore
    }

    try {
      await StopProxy();
    } catch {
      // ignore
    }
    useMonitoringStore().resetNetworkSpeedHistory();

    try {
      await Disconnect();
    } catch {
      // ignore
    }

    try {
      await StopService();
    } catch {
      // ignore
    }

    try {
      await StopLocalProxy();
    } catch {
      // ignore
    }

    try {
      await StartBootstrapLocalProxy();
    } catch (e) {
      console.error("failed to restore bootstrap local proxy", e);
    }

    loading.value = false;
    statusMessage.value = locale.t("$vuetify.service.initializing");
    await check();
  };

  const cancelStartup = async () => {
    startupCanceled.value = true;
    await CancelConnect();
    connecting.value = false;
    loading.value = false;
    error.value = false;
    statusMessage.value = locale.t("$vuetify.startService.startupCanceled");
    await check();
  };
  const disconnect = async () => {
    loading.value = true;
    error.value = false;
    statusMessage.value = locale.t("$vuetify.service.disconnecting");
    await check();
    if (!serviceReady.value) {
      loading.value = false;
      return;
    }

    try {
      await Disconnect();
      appReady.value = false;
      statusMessage.value = locale.t("$vuetify.service.disconnected");
    } catch (e) {
      error.value = true;
      statusMessage.value = locale.t("$vuetify.service.connetionFailed");
    } finally {
      await check();
      loading.value = false;
    }
  };

  // NDIS
  const checkNDIS = async () => {
    ndisRunning.value = await IsProxyRunning();
  };
  const startProxy = async () => {
    const isRunning = await IsProxyRunning();
    if (isRunning) {
      await StopProxy();
      useMonitoringStore().resetNetworkSpeedHistory();
    }

    await StartProxy();
    ndisRunning.value = await IsProxyRunning();
  };
  const stopProxy = async () => {
    await StopProxy();
    ndisRunning.value = await IsProxyRunning();
    useMonitoringStore().resetNetworkSpeedHistory();
  };
  const toggleNDIS = async () => {
    ndisRunning.value = await IsProxyRunning();
    if (ndisRunning.value) {
      await stopProxy();
    } else {
      await startProxy();
    }
  };

  // network analysis
  const updateEcho = async () => {
    routes.value = await GetRoutes();
  };
  const pingNode = async (tag: string) => {
    const result = await TestSpecificNode(tag);
    return result;
  };

  const localized = (item: Record<string, string>) => {
    return item[locale.current.value] || item["en"];
  };

  const availableInterfaceNames = computed(() => {
    const names = new Set(interfaces.value.map((iface) => iface.Name));
    for (const name of Object.keys(latency.value?.interfaces ?? {})) {
      names.add(name);
    }
    const { probedInterfaceNames } = useMonitoringStore();
    for (const name of probedInterfaceNames.value ?? []) {
      names.add(name);
    }
    return [...names];
  });

  const availableInterfaces = computed(() => {
    const byName = new Map(
      interfaces.value.map((iface) => [iface.Name, iface] as const)
    );
    for (const name of availableInterfaceNames.value) {
      if (!byName.has(name)) {
        byName.set(name, { Name: name, Flags: 0 } as Interface);
      }
    }
    return [...byName.values()];
  });

  // Helper functions for unavailable interfaces
  const updateProfileUnavailableInterfaces = (profileId: string) => {
    const profileState = profileStates.value[profileId];
    if (!profileState) {
      delete profileUnavailableInterfaces.value[profileId];
      return;
    }

    const available = new Set(availableInterfaceNames.value);

    const unavailableInterfaces: string[] = [];

    // Check default_interface
    if (
      profileState.default_interface &&
      !available.has(profileState.default_interface)
    ) {
      unavailableInterfaces.push(profileState.default_interface);
    }

    // Check network_interfaces
    const selectedInterfaces = profileState.network_interfaces || [];
    const unavailableNetworkInterfaces = selectedInterfaces.filter(
      (name) => !available.has(name)
    );
    unavailableInterfaces.push(...unavailableNetworkInterfaces);

    if (unavailableInterfaces.length > 0) {
      profileUnavailableInterfaces.value[profileId] = unavailableInterfaces;
    } else {
      delete profileUnavailableInterfaces.value[profileId];
    }
  };

  const hasUnavailableInterfaces = (profileId: string): boolean => {
    return profileUnavailableInterfaces.value[profileId]?.length > 0;
  };

  const getUnavailableInterfaces = (profileId: string): string[] => {
    return profileUnavailableInterfaces.value[profileId] || [];
  };

  const hasTitleUnavailableInterfaces = (titleId: string): boolean => {
    const titleProfiles = profiles.value.filter(profile => profile.title_id === titleId);
    return titleProfiles.some(profile => hasUnavailableInterfaces(profile.id));
  };

  const getTitleUnavailableInterfaces = (titleId: string): string[] => {
    const titleProfiles = profiles.value.filter(profile => profile.title_id === titleId);
    const allUnavailableInterfaces: string[] = [];
    
    titleProfiles.forEach(profile => {
      const unavailableInterfaces = getUnavailableInterfaces(profile.id);
      allUnavailableInterfaces.push(...unavailableInterfaces);
    });
    
    return [...new Set(allUnavailableInterfaces)]; // Remove duplicates
  };

  const applyLatencyUpdate = (incoming: MultiInterfaceLatency) => {
    latencyPingCache.value = mergeLatencyPingCache(
      latencyPingCache.value,
      incoming
    );
    latency.value = {
      ...incoming,
      interfaces: Object.fromEntries(
        Object.entries(incoming.interfaces ?? {}).map(([name, iface]) => [
          name,
          {
            ...iface,
            pings: (iface.pings ?? []).slice(-PING_RAW_CAP),
          },
        ])
      ),
    };
    Object.keys(profileStates.value).forEach((profileId) => {
      updateProfileUnavailableInterfaces(profileId);
    });
  };

  const applyLatencySnapshot = (snapshot: {
    latency: MultiInterfaceLatency;
    latencyPingCache: LatencyPingCache;
  }) => {
    latencyPingCache.value = JSON.parse(
      JSON.stringify(snapshot.latencyPingCache)
    ) as LatencyPingCache;
    if (snapshot.latency) {
      latency.value = JSON.parse(
        JSON.stringify(snapshot.latency)
      ) as MultiInterfaceLatency;
    }
  };

  return {
    isLagZap: false,

    // State
    connected,
    online,
    usable,
    appReady,
    internetStatus,
    status,
    abilities,
    displayLimit,
    loading,
    connecting,
    startupCanceled,
    statusMessage,
    error,
    optimizing,
    optimizeProgress,
    optimizeMinimized,
    serviceReady,
    ndisRunning,
    titles,
    profiles,
    regions,
    nodes,
    titleStates,
    profileStates,
    clientInfo,
    routes,
    latency,
    latencyPingCache,

    defaultInterface,
    interfaces,
    availableInterfaceNames,
    availableInterfaces,
    updateInterfaces,
    profileUnavailableInterfaces,

    // Getters
    isReady,
    getTitles,
    getRecentTitles,

    // Actions
    initialize,
    toggleTitleState,
    toggleProfileState,
    setDisplayLimit,
    isTitleActive,
    isProfileActive,
    activateTitle,
    deactivateTitle,
    saveTitleState,
    activateProfile,
    deactivateProfile,
    saveProfileState,
    visitTitle,
    upsertTitles,
    upsertProfiles,
    upsertTitleStates,
    upsertRegions,
    upsertNodes,
    deleteTitle,
    deleteProfile,
    deleteRegion,
    deleteNode,
    findTitleByRuleTag,
    findProfileByRuleTag,
    check,
    connect,
    cancelStartup,
    resetStartupCancel,
    resetToPreStartup,
    disconnect,
    checkNDIS,
    startProxy,
    stopProxy,
    toggleNDIS,
    updateEcho,
    pingNode,
    applyLatencyUpdate,
    applyLatencySnapshot,

    localized,
    
    // Unavailable interfaces helpers
    updateProfileUnavailableInterfaces,
    hasUnavailableInterfaces,
    getUnavailableInterfaces,
    hasTitleUnavailableInterfaces,
    getTitleUnavailableInterfaces,
  };
});
