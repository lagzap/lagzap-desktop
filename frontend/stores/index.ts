import { defineStore } from "pinia";
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  IsNDISRunning,
  IsRunning,
  StartNDIS,
  StartService,
  StopNDIS,
  StopService,
  ActionTitle,
  GetOptimizeResults,
  TestSpecificNode,
  ActionProfile,
  FetchData,
  StartOptimizing,
  Status,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import {
  RoutingMode,
  type NodeOptimizeResult,
  type Profile,
  type ProfileState,
  type Region,
  type Title,
  type TitleState,
  type Node,
  OptimizeProgress,
} from "~/bindings/github.com/lagzap/lagzap/adapter";
import { Events } from "@wailsio/runtime";
import { displayError } from "~/composables/alert";
import { getToken } from "~/utils/indexedDB";
import { useLocale } from "vuetify";
import { ConnectionStatus } from "~/constants/status";
import { debounce } from "es-toolkit";

export const useStore = defineStore("index", () => {
  const locale = useLocale();
  // State
  const status = ref<ConnectionStatus>(ConnectionStatus.StatusConnected);
  const abilities = ref<string[]>(["admin"]);
  const displayLimit = ref<number>(10);
  const loading = ref<boolean>(false);
  const driverInstalled = ref<boolean | null>(null);
  const statusMessage = ref<string>("Initializing");
  const error = ref<boolean>(false);
  const optimizeProgress = ref<OptimizeProgress | null>(null);
  const serviceReady = ref<boolean>(false);
  const ndisRunning = ref<boolean>(false);

  const recentTitles = ref<Record<string, number>>({});

  const titles = ref<Title[]>([]);
  const profiles = ref<Profile[]>([]);
  const regions = ref<Record<string, Region>>({});
  const nodes = ref<Record<string, Node>>({});
  const titleStates = ref<Record<string, TitleState>>({});
  const profileStates = ref<Record<string, ProfileState>>({});
  const loadingTitleStates = ref<string[]>([]);
  const loadingProfileStates = ref<string[]>([]);
  const echo = ref<Record<string, NodeOptimizeResult>>({});

  // Getters
  const isReady = computed(() => serviceReady.value);
  const connected = computed(
    () => status.value == ConnectionStatus.StatusConnected
  );
  const optimizing = computed(
    () => optimizeProgress.value !== null && !optimizeProgress.value.is_complete
  );

  const getTitles = computed((): Title[] => {
    const activeTitles = titles.value
      .filter((title) => titleStates.value[title.id]?.active === true)
      .sort(
        (a, b) =>
          (recentTitles.value[b.id] || 0) - (recentTitles.value[a.id] || 0)
      );
    const inactiveTitles = titles.value
      .filter((title) => titleStates.value[title.id]?.active !== true)
      .sort(
        (a, b) =>
          (recentTitles.value[b.id] || 0) - (recentTitles.value[a.id] || 0)
      );
    return [...activeTitles, ...inactiveTitles];
  });

  const getRecentTitles = computed((): Title[] => {
    const activeTitles = titles.value
      .filter((title) => titleStates.value[title.id]?.active === true)
      .sort(
        (a, b) =>
          (recentTitles.value[b.id] || 0) - (recentTitles.value[a.id] || 0)
      )
      .slice(0, displayLimit.value);
    const inactiveTitles = titles.value
      .filter((title) => titleStates.value[title.id]?.active !== true)
      .sort(
        (a, b) =>
          (recentTitles.value[b.id] || 0) - (recentTitles.value[a.id] || 0)
      )
      .slice(0, displayLimit.value);

    const titlesArray = [...activeTitles, ...inactiveTitles];
    return displayLimit.value > 0
      ? titlesArray.slice(0, displayLimit.value)
      : titlesArray;
  });

  const initialize = async (callback?: () => void) => {
    loading.value = true;
    error.value = false;

    try {
      statusMessage.value = locale.t("$vuetify.service.preparing");
      await checkService();
      if (!serviceReady.value) {
        await connect();
      }
      driverInstalled.value = true;

      statusMessage.value = locale.t("$vuetify.service.fetchingData");
      await FetchData();

      statusMessage.value = locale.t("$vuetify.service.ready");
      if (callback !== undefined) {
        callback();
      }
    } catch (err) {
      if (err.message.includes("initialize ndiapi")) {
        driverInstalled.value = false;
        statusMessage.value = locale.t(
          "$vuetify.service.driverMustBeInstalled"
        );
      } else {
        statusMessage.value = locale.t("$vuetify.service.couldNotStartService");
      }
      error.value = true;
      throw err;
    } finally {
      loading.value = false;
    }
  };

  // Setup event listeners
  onMounted(async () => {
    await checkService();
    Events.On("connection_status", ({ data }) => (status.value = data[0]));
    Events.On("service-started", async () => await checkService());
    Events.On("service-stopped", async () => await checkService());
    Events.On("titles", ({ data }) => upsertTitles(data[0]));
    Events.On("delete_title", ({ data }) => deleteTitle(data[0]));
    Events.On("profiles", ({ data }) => upsertProfiles(data[0]));
    Events.On("delete_profile", ({ data }) => deleteProfile(data[0]));
    Events.On("title_states", ({ data }) => upsertTitleStates(data[0]));
    Events.On("profile_states", ({ data }) => upsertProfileStates(data[0]));
    Events.On("delete_profile", ({ data }) => deleteProfile(data[0]));
    Events.On("regions", ({ data }) => upsertRegions(data[0]));
    Events.On("delete_region", ({ data }) => deleteRegion(data[0]));
    Events.On("nodes", ({ data }) => upsertNodes(data[0]));
    Events.On("delete_node", ({ data }) => deleteNode(data[0]));
    Events.On("echo_progress", async ({ data }) => {
      optimizeProgress.value = data[0];
      status.value = await Status();
    });
    Events.On("echo_results", ({ data }) => {
      const results = data[0];
      Object.entries(results).forEach(([key, value]) => {
        echo.value[key] = value as NodeOptimizeResult;
      });
    });
  });

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
    if (titleStates.value[id]) {
      titleStates.value[id].active = true;
    }
    saveTitleState(id);
  };
  const deactivateTitle = async (id: string) => {
    if (titleStates.value[id]) {
      titleStates.value[id].active = false;
    }
    saveTitleState(id);
  };
  const saveTitleState = debounce(async (id: string) => {
    try {
      loadingTitleStates.value.push(id);
      const updatedState = await ActionTitle(titleStates.value[id]);
      titleStates.value[id] = updatedState;
    } catch (e) {
      displayError(e, locale);
    } finally {
      loadingTitleStates.value = loadingTitleStates.value.filter(
        (id) => id !== id
      );
    }
  }, 500);
  const activateProfile = async (profileId: string) => {
    if (profileStates.value[profileId]) {
      profileStates.value[profileId].active = true;
    }
    await saveActionProfile(profileId);
  };
  const deactivateProfile = async (profileId: string) => {
    if (profileStates.value[profileId]) {
      profileStates.value[profileId].active = false;
    }
    await saveActionProfile(profileId);
  };
  const saveActionProfile = debounce(async (profileId: string) => {
    try {
      loadingProfileStates.value.push(profileId);
      const updatedState = await ActionProfile(profileStates.value[profileId]);
      profileStates.value[profileId] = updatedState;
    } catch (e) {
      displayError(e, locale);
    } finally {
      loadingProfileStates.value = loadingProfileStates.value.filter(
        (id) => id !== profileId
      );
    }
  }, 500);
  const visitTitle = async (id: string) => {
    if (titleStates.value[id]) {
      titleStates.value[id].visited_at = Date.now();
      if (!titleStates.value[id].active) {
        recentTitles.value[id] = Date.now();
      }
    } else {
      titleStates.value[id] = {
        active: false,
        titleId: id,
        visited_at: Date.now(),
      };
    }

    try {
      const updatedState = await ActionTitle(titleStates.value[id]);
      titleStates.value[id] = updatedState;
    } catch (e) {
      displayError(e, locale);
    }
  };

  const upsertTitles = (titlesArray: Title[]) => {
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
    for (const titleState of Object.values(states)) {
      titleStates.value[titleState.titleId] = titleState;
    }
  };
  const upsertProfileStates = (states: Record<string, ProfileState>) => {
    for (const profileState of Object.values(states)) {
      profileStates.value[profileState.profileId] = profileState;
    }
  };
  const upsertRegions = (newRegions: Region[]) => {
    newRegions.forEach((region) => {
      regions.value[region.tag] = region;
    });
  };
  const upsertNodes = (newNodes: Node[]) => {
    newNodes.forEach((node) => {
      nodes.value[node.id] = node;
    });
    updateEcho();
  };
  const deleteTitle = (id: string) => {
    const titleIndex = titles.value.findIndex((title) => title.id === id);
    if (titleIndex !== -1) {
      titles.value.splice(titleIndex, 1);
      delete recentTitles.value[id];

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
    delete echo.value[id];
  };
  const findTitleByRuleTag = (rule_tag: string): Title | undefined => {
    const profileEntry = profiles.value.find(
      (profile) => profile.rule_id === rule_tag
    );
    if (!profileEntry) return undefined;
    return titles.value.find((title) => title.id === profileEntry.title_id);
  };
  const findProfileByRuleTag = (rule_tag: string): Profile | undefined => {
    return profiles.value.find((profile) => profile.rule_id === rule_tag);
  };
  const checkService = async () => {
    serviceReady.value = await IsRunning();
    ndisRunning.value = await IsNDISRunning();
    status.value = await Status();
  };
  const connect = async () => {
    await checkService();
    if (serviceReady.value) {
      loading.value = false;
      return;
    }
    statusMessage.value = locale.t("$vuetify.service.connecting");

    try {
      const accessToken = (await getToken("lz.access_token")) ?? "";
      const a = await StartService("dev.lagzap-network.ir", accessToken);
      ndisRunning.value = await IsNDISRunning();
      const wasNdisRunning = ndisRunning.value;
      await checkNDIS();
      if (!ndisRunning.value && wasNdisRunning) {
        await startNDIS();
      }
    } catch (e) {
      error.value = true;
      statusMessage.value = e.getMessage();
      console.error(e);
      throw e;
    } finally {
      await checkService();
    }
  };
  const disconnect = async () => {
    loading.value = true;
    error.value = false;
    statusMessage.value = locale.t("$vuetify.service.disconnecting");
    await checkService();
    if (!serviceReady.value) {
      loading.value = false;
      return;
    }

    try {
      await StopService();
      statusMessage.value = locale.t("$vuetify.service.disconnected");
    } catch (e) {
      error.value = true;
      statusMessage.value = locale.t("$vuetify.service.connetionFailed");
    } finally {
      await checkService();
      loading.value = false;
    }
  };

  // NDIS
  const checkNDIS = async () => {
    ndisRunning.value = await IsNDISRunning();
  };
  const startNDIS = async () => {
    const isRunning = await IsNDISRunning();
    if (isRunning) await StopNDIS();

    await StartNDIS();
    ndisRunning.value = await IsNDISRunning();
  };
  const stopNDIS = async () => {
    await StopNDIS();
    ndisRunning.value = await IsNDISRunning();
  };
  const toggleNDIS = async () => {
    ndisRunning.value = await IsNDISRunning();
    if (ndisRunning.value) {
      await stopNDIS();
    } else {
      await startNDIS();
    }
  };

  // network analysis
  const optimize = async () => {
    await StartOptimizing();
  };
  const updateEcho = async () => {
    echo.value = await GetOptimizeResults();
  };
  const pingNode = async (tag: string) => {
    const result = await TestSpecificNode(tag);
    const [nodeResult] = result;
    echo.value[tag] = nodeResult;
    return nodeResult;
  };

  const localized = (item: Record<string, string>) => {
    return item[locale.current.value] || item["en"];
  };

  return {
    // State
    connected,
    status,
    abilities,
    displayLimit,
    loading,
    driverInstalled,
    statusMessage,
    error,
    optimizing,
    optimizeProgress,
    serviceReady,
    ndisRunning,
    recentTitles,
    titles,
    profiles,
    regions,
    nodes,
    titleStates,
    profileStates,
    echo,

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
    loadingTitleStates,
    activateProfile,
    deactivateProfile,
    saveActionProfile,
    loadingProfileStates,
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
    checkService,
    connect,
    disconnect,
    checkNDIS,
    startNDIS,
    stopNDIS,
    toggleNDIS,
    optimize,
    updateEcho,
    pingNode,

    localized,
  };
});
