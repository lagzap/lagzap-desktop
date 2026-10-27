import { defineStore, acceptHMRUpdate } from "pinia";
import { ref, shallowRef, computed } from "vue";
import {
  IsProxyRunning,
  IsRunning,
  StartProxy,
  SetVirtualAdapter,
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
  GetTitles,
  GetProfiles,
  GetProfileStates,
  GetRegions,
  GetNodes,
  ClearDNSCache,
  VisitTitle,
  GetInterfaces,
  GetClientInfo,
  CancelConnect,
  StopService,
  StopLocalProxy,
  StartBootstrapLocalProxy,
  GetOptimizeProgress,
  GetIfaceEntryRTTs,
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
import { PING_RAW_CAP } from "~/constants/pingChart";

/**
 * Wails v3 `Event.Emit(name, oneArg)` sets `event.data = oneArg` (not wrapped).
 * Older comments about `data[0]` only apply when the arg itself is already an
 * array, or when callers pass multiple Emit args.
 */
function asEntityList(data: unknown): any[] {
  if (data == null) return [];
  if (Array.isArray(data)) {
    if (data.length === 1 && Array.isArray(data[0])) return data[0];
    return data;
  }
  if (typeof data === "object") return [data];
  return [];
}

function asEntityID(data: unknown): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data) && data.length === 1 && typeof data[0] === "string") {
    return data[0];
  }
  return String(data ?? "");
}

function asEntityMap(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  if (
    Array.isArray(data) &&
    data.length === 1 &&
    data[0] &&
    typeof data[0] === "object" &&
    !Array.isArray(data[0])
  ) {
    return data[0] as Record<string, unknown>;
  }
  return {};
}

function asObjectPayload(data: unknown): Record<string, any> | null {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, any>;
  }
  if (
    Array.isArray(data) &&
    data.length === 1 &&
    data[0] &&
    typeof data[0] === "object" &&
    !Array.isArray(data[0])
  ) {
    return data[0] as Record<string, any>;
  }
  return null;
}

function asStatesById(data: unknown, idKeys: string[]): Record<string, any> {
  if (Array.isArray(data)) {
    if (
      data.length === 1 &&
      data[0] &&
      typeof data[0] === "object" &&
      !Array.isArray(data[0])
    ) {
      const only = data[0] as Record<string, unknown>;
      const looksLikeState = idKeys.some((k) => k in only);
      if (!looksLikeState) {
        return only as Record<string, any>;
      }
    }
    const out: Record<string, any> = {};
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const id = idKeys
        .map((k) => (item as Record<string, unknown>)[k])
        .find((v) => typeof v === "string" && v);
      if (typeof id === "string") out[id] = item;
    }
    return out;
  }
  if (data && typeof data === "object") {
    return data as Record<string, any>;
  }
  return {};
}

function normalizeProfile(raw: any): Profile | null {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.id ?? raw.Id;
  if (!id) return null;
  const updates = raw.updates ?? raw.Updates ?? [];
  return {
    ...raw,
    id,
    title_id: raw.title_id ?? raw.titleId ?? raw.TitleId,
    route_action: raw.route_action ?? raw.routeAction,
    node_group_ids: raw.node_group_ids ?? raw.nodeGroupIds,
    created_at: raw.created_at ?? raw.createdAt,
    updated_at: raw.updated_at ?? raw.updatedAt,
    updates: Array.isArray(updates) ? updates : [],
  } as Profile;
}

function normalizeTitle(raw: any): Title | null {
  if (!raw || typeof raw !== "object") return null;
  const id = raw.id ?? raw.Id;
  if (!id) return null;
  const updates = raw.updates ?? raw.Updates ?? [];
  return {
    ...raw,
    id,
    icon_url: raw.icon_url ?? raw.iconUrl,
    created_at: raw.created_at ?? raw.createdAt,
    updated_at: raw.updated_at ?? raw.updatedAt,
    updates: Array.isArray(updates) ? updates : [],
  } as Title;
}

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
  /** Bumped on each optimize start/event so a stale "clear after complete" timer
   * cannot wipe a newly started run. */
  let optimizeClearGeneration = 0;
  const initializingApp = ref(false);
  const startupOptimizeDone = ref(false);
  const serviceReady = ref<boolean>(false);
  const appReady = ref<boolean>(false);
  const ndisRunning = ref<boolean>(false);
  // Replaced whole twice a second and never mutated: no deep proxies.
  const latency = shallowRef<MultiInterfaceLatency | null>(null);

  const titles = ref<Title[]>([]);
  const profiles = ref<Profile[]>([]);
  const regions = ref<Record<string, Region>>({});
  const nodes = ref<Record<string, Node>>({});
  const titleStates = ref<Record<string, TitleState>>({});
  const profileStates = ref<Record<string, ProfileState>>({});
  const routes = ref<Record<string, RelayRoute>>({});
  /** Optimize client→entry RTT per NIC: key = `${iface}|${ip}|${tcp|udp|icmp}`. */
  const ifaceEntryRtt = ref<Record<string, number>>({});
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

  const initialize = async (
    callback?: () => void,
    options?: { startProxy?: boolean }
  ) => {
    if (startupCanceled.value) {
      return;
    }
    initializingApp.value = true;
    loading.value = true;
    error.value = false;
    // activeOnStart only controls NDIS/proxy — coordinator sync always runs.
    const startProxy = options?.startProxy !== false;

    try {
      // Startup splash owns these strings; connect() must not clobber them.
      statusMessage.value = locale.t("$vuetify.service.fetchingData");
      await check();
      if (startupCanceled.value) {
        return;
      }
      if (!connected.value) {
        await connect();
      }
      if (startupCanceled.value) {
        return;
      }

      statusMessage.value = locale.t("$vuetify.service.preparing");
      await waitForOptimizeComplete();
      if (startupCanceled.value) {
        return;
      }

      // Hydrate per-NIC entry RTTs from optimize (events may have been missed).
      try {
        const rtts = await GetIfaceEntryRTTs();
        if (rtts && typeof rtts === "object") {
          const next: Record<string, number> = {};
          for (const [key, value] of Object.entries(rtts as Record<string, unknown>)) {
            const n = typeof value === "number" ? value : Number(value);
            if (key && Number.isFinite(n) && n >= 20 && n < 500) {
              next[key] = n;
            }
          }
          if (Object.keys(next).length > 0) {
            ifaceEntryRtt.value = next;
          }
        }
      } catch {
        // optional — live iface-entry-rtt events still apply
      }

      startupOptimizeDone.value = true;
      statusMessage.value = locale.t("$vuetify.service.ready");
      optimizeProgress.value = null;
      await nextTick();
      if (startProxy) {
        // Capture mode first (Windows: NDIS, or the optional virtual adapter).
        try {
          await SetVirtualAdapter(useSettings().settings.value.virtualAdapter === true);
        } catch (error) {
          console.warn("Could not set virtual adapter mode:", error);
        }
        await StartProxy();
      }
      await check();
      await ClearDNSCache();

      appReady.value = true;
      startupOptimizeDone.value = false;
      if (callback !== undefined) {
        callback();
      }
    } catch (err) {
      if (startupCanceled.value) {
        return;
      }
      startupOptimizeDone.value = false;
      console.dir(err);

      error.value = true;
      throw err;
    } finally {
      initializingApp.value = false;
      loading.value = false;
    }
  };

  const restoreAfterReload = async (path: string, startProxy: boolean) => {
    if (appReady.value || startupCanceled.value) {
      return;
    }
    if (
      path.startsWith("/start-service") ||
      path.startsWith("/auth") ||
      path.startsWith("/latency-overlay")
    ) {
      return;
    }
    await check();
    if (!serviceReady.value) {
      return;
    }

    // Dev HMR / soft reload: service is already up — skip full startup
    // (optimize wait) so toggles don't sit disabled for seconds.
    if (connected.value) {
      try {
        await hydrateRuntimeData();
        await updateInterfaces();
        appReady.value = true;
        loading.value = false;
        initializingApp.value = false;
        statusMessage.value = locale.t("$vuetify.service.ready");
        return;
      } catch (err) {
        console.error("Soft restore after reload failed:", err);
        // Fall through to full initialize.
      }
    }

    try {
      await initialize(undefined, { startProxy });
    } catch (err) {
      console.error("Failed to restore session after reload:", err);
    }
  };

  const hydrateRuntimeData = async () => {
    const [
      titlesData,
      profilesData,
      titleStatesData,
      profileStatesData,
      regionsData,
      nodesData,
      routesData,
    ] = await Promise.all([
      GetTitles().catch(() => null),
      GetProfiles().catch(() => null),
      GetTitleStates().catch(() => null),
      GetProfileStates().catch(() => null),
      GetRegions().catch(() => null),
      GetNodes().catch(() => null),
      GetRoutes().catch(() => null),
    ]);

    if (titlesData && typeof titlesData === "object") {
      titles.value = Object.values(titlesData as Record<string, Title>);
    }
    if (profilesData && typeof profilesData === "object") {
      profiles.value = Object.values(profilesData as Record<string, Profile>);
    }
    if (titleStatesData && typeof titleStatesData === "object") {
      titleStates.value = titleStatesData as Record<string, TitleState>;
    }
    if (profileStatesData && typeof profileStatesData === "object") {
      profileStates.value = {
        ...profileStates.value,
        ...(profileStatesData as Record<string, ProfileState>),
      };
    }
    if (regionsData && typeof regionsData === "object") {
      regions.value = regionsData as Record<string, Region>;
    }
    if (nodesData && typeof nodesData === "object") {
      nodes.value = nodesData as Record<string, Node>;
    }
    if (routesData && typeof routesData === "object") {
      routes.value = routesData as Record<string, RelayRoute>;
    }
  };

  // Setup event listeners once at store creation. Do NOT tie these to a
  // component onMounted/onUnmounted — Pinia binds those to the first consumer,
  // and Events.OffAll() on unmount wiped live profile/title updates after
  // navigating away from that page.
  let unavailableIfaceTimer: ReturnType<typeof setTimeout> | null = null;
  Events.On("status", ({ data }) => (status.value = data));
  Events.On("service-started", async () => await check());
  Events.On("service-stopped", async () => {
    appReady.value = false;
    await check();
  });
  Events.On("titles", ({ data }) => upsertTitles(asEntityList(data)));
  Events.On("title-delete", ({ data }) => deleteTitle(asEntityID(data)));
  Events.On("profiles", ({ data }) => upsertProfiles(asEntityList(data)));
  Events.On("profile-delete", ({ data }) => deleteProfile(asEntityID(data)));
  Events.On("title_states", ({ data }) =>
    upsertTitleStates(asStatesById(data, ["titleId", "title_id"]))
  );
  Events.On("profile_states", ({ data }) =>
    upsertProfileStates(asStatesById(data, ["profileId", "profile_id"]))
  );
  Events.On("client_info", ({ data }) => {
    clientInfo.value = asEntityMap(data) as typeof clientInfo.value;
  });
  Events.On("regions", ({ data }) => upsertRegions(asEntityList(data)));
  Events.On("region-delete", ({ data }) => deleteRegion(asEntityID(data)));
  Events.On("nodes", ({ data }) => upsertNodes(asEntityList(data)));
  Events.On("node-delete", ({ data }) => deleteNode(asEntityID(data)));
  Events.On("relay-routes", ({ data }) => {
    const raw = asEntityMap(data) as Record<string, RelayRoute>;
    if (!raw || Object.keys(raw).length === 0) {
      return;
    }
    routes.value = {
      ...routes.value,
      ...raw,
    };
  });
  Events.On("iface-entry-rtt", ({ data }) => {
    const raw = asObjectPayload(data);
    if (!raw) {
      return;
    }
    const next: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
      const n = typeof value === "number" ? value : Number(value);
      // Drop path-matrix stubs — they are not client→entry RTTs.
      if (key && Number.isFinite(n) && n >= 20 && n < 500) {
        next[key] = n;
      }
    }
    ifaceEntryRtt.value = next;
  });
  Events.On("route-probe", ({ data }) => {
    const raw = asObjectPayload(data);
    if (raw) {
      const event = raw as {
        route_tag?: string;
        slots?: Array<{
          iface?: string;
          path_key?: string;
          network?: string;
          latency?: number;
          packet_loss?: number;
        }>;
      };
      const slots = event.slots;
      let relayNodeId = (event.route_tag || "").trim();
      for (const suffix of [
        "-ipv4-udp",
        "-ipv4-tcp",
        "-ipv6-udp",
        "-ipv6-tcp",
      ]) {
        if (relayNodeId.endsWith(suffix)) {
          relayNodeId = relayNodeId.slice(0, -suffix.length);
          break;
        }
      }
      if (slots?.length) {
        let changed = false;
        const next = { ...ifaceEntryRtt.value };
        const write = (key: string, latency: number) => {
          // Path-matrix stubs (1–8ms) must never become client→entry RTT.
          // Also do NOT keep the historical minimum — that made city pings
          // drift downward forever after one bad sample.
          if (!(latency >= 20) || latency >= 500) {
            return;
          }
          const prev = next[key];
          if (prev === latency) {
            return;
          }
          // Ignore sudden impossible drops vs a healthy prior sample.
          if (prev >= 40 && latency < Math.max(20, prev * 0.45)) {
            return;
          }
          next[key] = latency;
          changed = true;
        };
        for (const slot of slots) {
          const iface = (slot.iface || "").trim();
          const latency = Number(slot.latency);
          if (!iface || !(latency > 0) || (slot.packet_loss ?? 0) >= 100) {
            continue;
          }
          const pathKey = (slot.path_key || "").trim();
          const hop = pathKey.split("->")[0]?.trim();
          const network = (slot.network || "udp").toLowerCase();
          const singleHop = !!pathKey && !pathKey.includes("->");
          let entryId = "";
          let ipVersion = "ipv4";
          if (hop) {
            for (const node of Object.values(nodes.value ?? {})) {
              if (!node) continue;
              if (node.ipv4 === hop) {
                entryId = node.id;
                ipVersion = "ipv4";
                break;
              }
              if (node.ipv6 === hop) {
                entryId = node.id;
                ipVersion = "ipv6";
                break;
              }
            }
          }
          // Live slot latency is E2E. Only stamp under entry for single-hop
          // paths — multi-hop E2E must never poison hop0 (user→edge).
          if (singleHop && entryId) {
            write(`${iface}|${entryId}|${ipVersion}|${network}`, latency);
          }
          if (relayNodeId) {
            write(
              `${iface}|${relayNodeId}|${ipVersion}|${network}`,
              latency
            );
          }
        }
        if (changed) {
          ifaceEntryRtt.value = next;
        }
      }
    }
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
  Events.On("optimize", ({ data }) => {
    const raw = asObjectPayload(data);
    if (!raw) {
      return;
    }

    const normalized = {
      total_tests: raw.total_tests ?? raw.totalTests ?? 0,
      completed_tests: raw.completed_tests ?? raw.completedTests ?? 0,
      is_complete: !!(raw.is_complete ?? raw.isComplete),
      progress: raw.progress ?? 0,
      phase: raw.phase || "probe",
      probe_total: raw.probe_total ?? raw.probeTotal ?? 0,
      probe_completed: raw.probe_completed ?? raw.probeCompleted ?? 0,
      verify_total: raw.verify_total ?? raw.verifyTotal ?? 0,
      verify_completed: raw.verify_completed ?? raw.verifyCompleted ?? 0,
      interfaces: raw.interfaces ?? [],
    };

    const wasRunning =
      optimizeProgress.value != null && !optimizeProgress.value.is_complete;
    optimizeProgress.value = normalized;
    // Only force-expand on a fresh run — every progress tick used to reset
    // minimize and immediately reopen the panel.
    if (!wasRunning && !normalized.is_complete) {
      optimizeMinimized.value = false;
      // New run clears prior NIC entry samples until fresh probes arrive.
      ifaceEntryRtt.value = {};
    }

    if (normalized.is_complete) {
      const clearGen = ++optimizeClearGeneration;
      if (!initializingApp.value) {
        statusMessage.value = `${normalized.progress ?? 0}%`;
        window.setTimeout(() => {
          // Only clear if nothing newer started / arrived since this complete.
          if (
            clearGen === optimizeClearGeneration &&
            optimizeProgress.value?.is_complete
          ) {
            optimizeProgress.value = null;
          }
        }, 900);
      }
      return;
    }
    // Incomplete event = a live run; invalidate any pending clear timer.
    optimizeClearGeneration++;
    if (!initializingApp.value) {
      statusMessage.value = `${normalized.progress ?? 0}%`;
    }
  });
  Events.On("interfaces-updated", async () => {
    await updateInterfaces();
  });

  // Picks up a running service after a UI reload (hard reload, HMR full
  // reload). app.vue calls it on mount: a store onMounted never fired, since
  // the latency plugin creates this store before any component exists, so a
  // reloaded UI showed "disconnected" until the whole app restarted.
  // Nuxt composables are read before the first await, while the caller's
  // component instance is still current.
  let resumed = false;
  const resumeSession = async () => {
    if (resumed) {
      return;
    }
    resumed = true;
    const route = useRoute();
    const { user, isAuthenticated, init: sanctumInit } = useSanctumAuth<DataResponse>();
    const { settings } = useSettings();
    await check();

    // On /start-service, start() owns
    // ReloadService + identity — racing sanctumInit here fails, clearAuthSession
    // wipes the token, and the splash stuck with loading=false / no cancel.
    // Admin / overlay webviews share the same IndexedDB token — same rule.
    if (
      route.path.startsWith("/start-service") ||
      route.path.startsWith("/auth") ||
      route.path.startsWith("/admin") ||
      route.path.startsWith("/latency-overlay")
    ) {
      return;
    }

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

    await restoreAfterReload(route.path, settings.value.activeOnStart !== false);
  };

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
    if (!Array.isArray(titlesArray) || titlesArray.length === 0) return;
    const next = [...titles.value];
    for (const raw of titlesArray) {
      const title = normalizeTitle(raw);
      if (!title?.id) continue;
      const existingIndex = next.findIndex((t) => t.id === title.id);
      if (existingIndex !== -1) {
        next[existingIndex] = { ...next[existingIndex], ...title };
      } else {
        next.push(title);
      }
    }
    titles.value = next;
  };
  const upsertProfiles = (profilesArray: Profile[]) => {
    if (!Array.isArray(profilesArray) || profilesArray.length === 0) return;
    const next = [...profiles.value];
    for (const raw of profilesArray) {
      const profile = normalizeProfile(raw);
      if (!profile?.id) continue;
      const existingIndex = next.findIndex((p) => p.id === profile.id);
      if (existingIndex !== -1) {
        next[existingIndex] = { ...next[existingIndex], ...profile };
      } else {
        next.push(profile);
      }
    }
    profiles.value = next;
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
    if (!initializingApp.value) {
      statusMessage.value = locale.t("$vuetify.service.connecting");
    }
    await updateInterfaces();
    await check();
    if (connected.value) {
      connecting.value = false;
      if (appReady.value) {
        loading.value = false;
      }
      return;
    }
    if (startupCanceled.value) {
      connecting.value = false;
      return;
    }
    if (!initializingApp.value) {
      statusMessage.value = locale.t("$vuetify.service.fetchingData");
    }

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
      statusMessage.value = (e as Error).message;

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
    initializingApp.value = false;
    startupOptimizeDone.value = false;

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
  const ndisToggling = ref(false);
  const startProxy = async () => {
    const isRunning = await IsProxyRunning();
    if (isRunning) {
      await StopProxy();
    }

    await StartProxy();
    ndisRunning.value = await IsProxyRunning();
  };
  const stopProxy = async () => {
    await StopProxy();
    ndisRunning.value = await IsProxyRunning();
  };
  /** Drive the overall routing switch — optimistic UI, then sync from Go. */
  const setNDIS = async (wantOn: boolean) => {
    if (ndisToggling.value || !serviceReady.value) {
      return;
    }
    ndisToggling.value = true;
    const previous = ndisRunning.value;
    ndisRunning.value = wantOn;
    try {
      if (wantOn) {
        await StartProxy();
      } else {
        await StopProxy();
      }
      ndisRunning.value = await IsProxyRunning();
    } catch {
      ndisRunning.value = previous;
      throw new Error("Failed to toggle routing");
    } finally {
      ndisToggling.value = false;
    }
  };
  const toggleNDIS = async () => {
    const running = await IsProxyRunning();
    await setNDIS(!running);
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
  // Game and app names: in the UI language, or in English when the user
  // turned on "English game names" (Settings → General).
  const titleName = (name: Record<string, string>) => {
    const { settings: appSettings } = useSettings();
    return (appSettings.value.englishTitleNames && name?.["en"]) || localized(name);
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

    // Runs on every latency tick: write only real changes, or every title
    // row reading it (sidebar, title page) re-renders twice a second.
    const current = profileUnavailableInterfaces.value[profileId];
    if (unavailableInterfaces.length > 0) {
      if (current?.join("|") !== unavailableInterfaces.join("|")) {
        profileUnavailableInterfaces.value[profileId] = unavailableInterfaces;
      }
    } else if (current) {
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

  const clearUnavailableInterfaces = async (profileId: string) => {
    const profileState = profileStates.value[profileId];
    if (!profileState) {
      return;
    }
    const unavailable = new Set(getUnavailableInterfaces(profileId));
    if (unavailable.size === 0) {
      return;
    }
    if (profileState.network_interfaces?.length) {
      profileState.network_interfaces = profileState.network_interfaces.filter(
        (name) => !unavailable.has(name)
      );
    }
    if (
      profileState.default_interface &&
      unavailable.has(profileState.default_interface)
    ) {
      profileState.default_interface = "";
    }
    updateProfileUnavailableInterfaces(profileId);
    await saveProfileState(profileId);
  };

  const clearTitleUnavailableInterfaces = async (titleId: string) => {
    const titleProfiles = profiles.value.filter(
      (profile) => profile.title_id === titleId
    );
    for (const profile of titleProfiles) {
      await clearUnavailableInterfaces(profile.id);
    }
  };

  const applyLatencyUpdate = (incoming: MultiInterfaceLatency) => {
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


  return {
    resumeSession,
    titleName,
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
    initializingApp,
    startupOptimizeDone,
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
    ifaceEntryRtt,
    latency,

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
    setNDIS,
    toggleNDIS,
    ndisToggling,
    updateEcho,
    pingNode,
    applyLatencyUpdate,

    localized,
    
    // Unavailable interfaces helpers
    updateProfileUnavailableInterfaces,
    clearUnavailableInterfaces,
    clearTitleUnavailableInterfaces,
    hasUnavailableInterfaces,
    getUnavailableInterfaces,
    hasTitleUnavailableInterfaces,
    getTitleUnavailableInterfaces,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useStore, import.meta.hot));
}
