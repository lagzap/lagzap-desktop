import { defineStore } from "pinia";
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  IsProxyRunning,
  IsRunning,
  StartProxy,
  StopProxy,
  ActionTitle,
  GetRoutes,
  TestSpecificNode,
  ActionProfile,
  FetchData,
  StartOptimizing,
  Status,
  SetAccessToken,
  SetEndpoints,
  SetLogLevel,
  Connect,
  Disconnect,
  GetTitleStates,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import {
  type RelayRoute,
  type Profile,
  type ProfileState,
  type Region,
  type Title,
  type TitleState,
  type Node,
  Optimize,
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
  const abilities = ref<string[]>([]);
  const displayLimit = ref<number>(10);
  const loading = ref<boolean>(false);
  const statusMessage = ref<string>(locale.t("$vuetify.service.initializing"));
  const error = ref<boolean>(false);
  const optimizeProgress = ref<Optimize | null>(null);
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
  const routes = ref<Record<string, RelayRoute>>({});

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
      await check();
      if (!connected.value) {
        await connect();
      }

      statusMessage.value = locale.t("$vuetify.service.fetchingData");
      await FetchData();

      statusMessage.value = locale.t("$vuetify.service.ready");
      if (callback !== undefined) {
        callback();
      }
    } catch (err) {
      console.dir(err);

      error.value = true;
      throw err;
    } finally {
      loading.value = false;
    }
  };

  // Setup event listeners
  onMounted(async () => {
    await check();
    Events.On("status", ({ data }) => (status.value = data[0]));
    Events.On("service-started", async () => await check());
    Events.On("service-stopped", async () => await check());
    Events.On("titles", ({ data }) => upsertTitles(data[0]));
    Events.On("title-delete", ({ data }) => deleteTitle(data[0]));
    Events.On("profiles", ({ data }) => upsertProfiles(data[0]));
    Events.On("profile-delete", ({ data }) => deleteProfile(data[0]));
    Events.On("title_states", ({ data }) => upsertTitleStates(data[0]));
    Events.On("profile_states", ({ data }) => upsertProfileStates(data[0]));
    Events.On("regions", ({ data }) => upsertRegions(data[0]));
    Events.On("region-delete", ({ data }) => deleteRegion(data[0]));
    Events.On("nodes", ({ data }) => upsertNodes(data[0]));
    Events.On("node-delete", ({ data }) => deleteNode(data[0]));
    Events.On("relay-routes", ({ data }) => {
      console.log("relay-routes", data[0]);
      const result = data[0] as Record<string, RelayRoute>;
      routes.value = result;
    });
    Events.On("optimize", async ({ data }) => {
      console.log("optimize", data[0]);
      optimizeProgress.value = data[0];
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
  const saveTitleState = debounce(async (id: string) => {
    try {
      loadingTitleStates.value.push(id);
      const updatedState = await ActionTitle(titleStates.value[id]);
      console.log(updatedState)
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
  }, 1000);
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
      console.log("visit", updatedState)
      titleStates.value[id] = updatedState;
    } catch (e) {
      displayError(e, locale);
    }
  };

  const upsertTitles = (titlesArray: Title[]) => {
    console.log(titlesArray)
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
  };
  const connect = async () => {
    await check();
    if (connected.value) {
      loading.value = false;
      return;
    }
    statusMessage.value = locale.t("$vuetify.service.connecting");

    try {
      const { user, isAuthenticated } = useSanctumAuth<DataResponse>();
      if (!isAuthenticated) {
        console.log(user, isAuthenticated);
        return;
      }
      const { endpoints, log_level } = user.value;
      abilities.value = user.value.abilities || [];
      const accessToken = (await getToken("lz.access_token")) ?? "";
      await SetAccessToken(accessToken);
      await SetEndpoints(endpoints);
      await SetLogLevel(log_level);
      await Connect();
      await check();
    } catch (e) {
      error.value = true;
      statusMessage.value = e.message;

      console.error(e);
      throw e;
    } finally {
      await check();
    }
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
    if (isRunning) await StopProxy();

    await StartProxy();
    ndisRunning.value = await IsProxyRunning();
  };
  const stopProxy = async () => {
    await StopProxy();
    ndisRunning.value = await IsProxyRunning();
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
  const optimize = async () => {
    await StartOptimizing();
  };
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

  return {
    // State
    connected,
    status,
    abilities,
    displayLimit,
    loading,
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
    routes,

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
    check,
    connect,
    disconnect,
    checkNDIS,
    startProxy,
    stopProxy,
    toggleNDIS,
    optimize,
    updateEcho,
    pingNode,

    localized,
  };
});
