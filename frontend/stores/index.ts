import {defineStore} from 'pinia'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import {StartNdisOptions} from '~/bindings/github.com/lagzap/lagzap-desktop';
import {
    AddProcess,
    IsNDISRunning,
    IsRunning,
    RemoveProcess,
    StartNDIS,
    StartService,
    StopNDIS,
    StopService,
    ActionTitle,
    GetOptimizeResults,
    TestSpecificNode,
    ActionProfile,
    FetchData,
} from '~/bindings/github.com/lagzap/lagzap-desktop/service';
import { RoutingMode, type NodeOptimizeResult, type Profile, type ProfileState, type Region, type Title, type TitleState, type Node } from '~/bindings/github.com/lagzap/lagzap/adapter';
import { ProfileFlag } from '~/constants/profile';
import { Events } from '@wailsio/runtime';
import { displayError } from '~/composables/alert';
import { getToken } from '~/utils/indexedDB';

export const useStore = defineStore('index', () => {
    console.log('store index')
    // State
    const abilities = ref<string[]>([])
    const displayLimit = ref<number>(10)
    const loading = ref<boolean>(false)
    const driverInstalled = ref<boolean | null>(null)
    const statusMessage = ref<string>("Initializing")
    const error = ref<boolean>(false)
    const optimizing = ref<boolean>(false)
    const serviceReady = ref<boolean>(false)
    const ndisRunning = ref<boolean>(false)
    const recentTitles = ref<Record<string, number>>({})
    const titles = ref<Record<string, Title>>({})
    const profiles = ref<Record<string, Profile>>({})
    const regions = ref<Record<string, Region>>({})
    const nodes = ref<Record<string, Node>>({})
    const titleStates = ref<Record<string, TitleState>>({})
    const profileStates = ref<Record<string, ProfileState>>({})
    const echo = ref<Record<string, NodeOptimizeResult>>({})

    // Getters
    const isReady = computed(() => serviceReady.value)
    
    const getTitles = computed((): Title[] => {
        const activeTitles = Object.values(titles.value)
            .filter(title => titleStates.value[title.id]?.active === true)
            .sort((a, b) => (recentTitles.value[b.id] || 0) - (recentTitles.value[a.id] || 0));
        const inactiveTitles = Object.values(titles.value)
            .filter(title => titleStates.value[title.id]?.active !== true)
            .sort((a, b) => (recentTitles.value[b.id] || 0) - (recentTitles.value[a.id] || 0));
        return [...activeTitles, ...inactiveTitles];
    })
    
    const getRecentTitles = computed((): Title[] => {
        const activeTitles = Object.values(titles.value)
            .filter(title => titleStates.value[title.id]?.active === true)
            .sort((a, b) => (recentTitles.value[b.id] || 0) - (recentTitles.value[a.id] || 0))
            .slice(0, displayLimit.value);
        const inactiveTitles = Object.values(titles.value)
            .filter(title => titleStates.value[title.id]?.active !== true)
            .sort((a, b) => (recentTitles.value[b.id] || 0) - (recentTitles.value[a.id] || 0))
            .slice(0, displayLimit.value);

        const titlesArray = [...activeTitles, ...inactiveTitles];
        return displayLimit.value > 0 ? titlesArray.slice(0, displayLimit.value) : titlesArray;
    })

    const getActiveProfilesForTitle = (titleId: string): string[] => {
        return Object.values(profileStates.value)
            .filter(profileState => profileState.titleId === titleId && profileState.active)
            .map(profileState => profileState.profileId);
    }

    const initialize = async (callback?: (() => void)) => {
        loading.value = true;
        error.value = false
        
        try {
            statusMessage.value = "Preparing service";
            await checkService();
            if (!serviceReady.value) {
                statusMessage.value = "Starting service";
                await startService();
            }
            driverInstalled.value = true

            statusMessage.value = "Fetching data";
            await FetchData();

            statusMessage.value = "LagZap is Ready!";
            if (callback !== undefined) {
                callback()
            }
        } catch (err) {
            if (err.message.includes('initialize ndiapi')) {
                driverInstalled.value = false
                statusMessage.value = "The LagZap driver must be installed for the application to function properly. Please install the driver.";
            } else {
                statusMessage.value = "Could not start the service!";
            }
            error.value = true
            throw err
        } finally {
            loading.value = false
        }
    }

    // Setup event listeners
    onMounted(() => {
        Events.On("service-started", async () => await checkService());
        Events.On("service-stopped", async () => await checkService());Events.On("titles", ({ data }) => upsertTitles(data[0]));
        Events.On("delete_title", ({ data }) => deleteTitle(data[0]));
        Events.On("profiles", ({ data }) => upsertProfiles(data[0]));
        Events.On("delete_profile", ({ data }) => deleteProfile(data[0]));
        Events.On("regions", ({ data }) => upsertRegions(data[0]));
        Events.On("delete_region", ({ data }) => deleteRegion(data[0]));
        Events.On("nodes", ({ data }) => upsertNodes(data[0]));
        Events.On("delete_node", ({ data }) => deleteNode(data[0]));
    })

    const toggleActiveState = async (title: Title) => {
        console.log("Toggling active state for title:", title.id);
        if (isTitleActive(title.id)) {
            await deactivateTitle(title.id);
            if (ndisRunning.value) {
                const titleObj = titles.value[title.id];
                if (titleObj && titleObj.profiles) {
                    const removePromises = Object.values(titleObj.profiles)
                        .map(profile => RemoveProcess(profile.process_regex, true, true));
                    await Promise.allSettled(removePromises);
                }
            }
        } else {
            await activateTitle(title.id);
            if (ndisRunning.value) {
                if (title.profiles) {
                    const addPromises = Object.values(title.profiles)
                        .map(profile => AddProcess(profile.process_regex, true, true));
                    await Promise.allSettled(addPromises);
                }
            }
        }
    }
    const setDisplayLimit = (limit: number) => {
        displayLimit.value = limit;
    }
    const isTitleActive = (id: string): boolean => {
        return titleStates.value[id]?.active === true;
    }
    const isProfileActive = (id: string): boolean => {
        return profileStates.value[id] !== undefined && profileStates.value[id].active;
    }
    const activateTitle = async (id: string) => {
        console.log("activating", id)
        if (isTitleActive(id)) {
            return
        }
        console.log("!activating", id)
        
        if (!titleStates.value[id]) {
            titleStates.value[id] = {
                active: true,
                titleId: id,
                mode: RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL,
                cities: [],
                countries: [],
                regions: [],
                visited_at: 0
            }
        } else {
            titleStates.value[id].active = true;
        }

        await setDefaultProfiles(id)
        try {
            const updatedState = await ActionTitle(id, titleStates.value[id])
            titleStates.value[id] = updatedState
        } catch (e) {
            displayError(e)
        }
    }
    const deactivateTitle = async (id: string) => {
        console.log("deactivating", id)
        if (titleStates.value[id]) {
            titleStates.value[id].active = false;
        }
        try {
            const updatedState = await ActionTitle(id, titleStates.value[id])
            titleStates.value[id] = updatedState
        } catch (e) {
            displayError(e)
        }
    }
    const activateProfile = async (titleId: string, profileId: string) => {
        if (!profileStates.value[profileId]) {
            profileStates.value[profileId] = {
                active: true,
                titleId: titleId,
                profileId: profileId,
                mode: RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL,
                regions: [],
                cities: [],
                countries: []
            };
        } else {
            profileStates.value[profileId].active = true;
            profileStates.value[profileId].titleId = titleId;
        }
        
        try {
            const updatedState = await ActionProfile(profileId, profileStates.value[profileId])
            profileStates.value[profileId] = updatedState
        } catch (e) {
            displayError(e)
        }
    }
    const deactivateProfile = async (titleId: string, profileId: string) => {
        if (profileStates.value[profileId]) {
            profileStates.value[profileId].active = false;
        }
        
        try {
            const updatedState = await ActionProfile(profileId, profileStates.value[profileId])
            profileStates.value[profileId] = updatedState
        } catch (e) {
            displayError(e)
        }
    }
    const visitTitle = async (id: string) => {
        recentTitles.value[id] = Date.now();
        
        if (titleStates.value[id]) {
            titleStates.value[id].visited_at = Date.now();
        } else {
            titleStates.value[id] = {
                active: false,
                titleId: id,
                mode: RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL,
                cities: [],
                countries: [],
                regions: [],
                visited_at: Date.now()
            }
        }
        
        try {
            const updatedState = await ActionTitle(id, titleStates.value[id])
            titleStates.value[id] = updatedState
        } catch (e) {
            displayError(e)
        }
    }
    const upsertTitles = (titlesArray: Title[]) => {
        for (const title of titlesArray) {
            titles.value[title.id] = title;
            if (title.profiles && Array.isArray(title.profiles)) {
                for (const profile of title.profiles) {
                    profiles.value[profile.id] = profile;
                }
            }
        }
    }
    const upsertProfiles = (profilesArray: Profile[]) => {
        for (const profile of profilesArray) {
            profiles.value[profile.id] = profile;
            for (const title of Object.values(titles.value)) {
                if (Array.isArray(title.profiles)) {
                    const idx = title.profiles.findIndex(p => p.id === profile.id);
                    if (idx !== -1) {
                        title.profiles[idx] = profile;
                    }
                }
            }
        }
    }
    const upsertRegions = (newRegions: Region[]) => {
        newRegions.forEach((region) => {
            regions.value[region.tag] = region
        })
    }
    const upsertNodes = (newNodes: Node[]) => {
        console.log(nodes)
        newNodes.forEach((node) => {
            nodes.value[node.id] = node
        })
        updateEcho();
    }
    const deleteTitle = (id: string) => {
        delete titles.value[id];
        delete recentTitles.value[id];
        const title = titles.value[id];
        if (title?.profiles) {
            for (const profile of title.profiles) {
                delete profiles.value[profile.id];
            }
        }
    }
    const deleteProfile = (id: string) => {
        delete profiles.value[id];
        for (const title of Object.values(titles.value)) {
            if (title.profiles) {
                title.profiles = title.profiles.filter(profile => profile.id !== id);
            }
        }
    }
    const deleteRegion = (tag: string) => {
        delete regions.value[tag];
    }
    const deleteNode = (id: string) => {
        delete nodes.value[id];
        delete echo.value[id];
    }
    const findTitleByProcessRegex = (processRegex: string): Title | undefined => {
        const profileEntry = Object.entries(profiles.value).find(
            ([, profile]) => profile.process_regex === processRegex
        );
        if (!profileEntry) return undefined;
        const [profileId] = profileEntry;
        return Object.values(titles.value).find(title => title.profiles && title.profiles[profileId]);
    }
    const findProfileByProcessRegex = (processRegex: string): Profile | undefined => {
        return Object.values(profiles.value).find(
            (profile) => profile.process_regex === processRegex
        );
    }
    const setDefaultProfiles = async (titleId: string) => {
        const title = titles.value[titleId];
        if (!title || !title.profiles) {
            return;
        }
        const defaultProfiles = Object.values(title.profiles).filter(
            (profile) => profile.flags & ProfileFlag.DEFAULT_SELECTED
        );
        
        for (const profile of defaultProfiles) {
            if (!isProfileActive(profile.id)) {
                await activateProfile(titleId, profile.id);
            }
        }
    }
    const activeDefaultProfile = (titleId: string) => {
        setDefaultProfiles(titleId);
    }
    const checkService = async () => {
        serviceReady.value = await IsRunning()
        ndisRunning.value = await IsNDISRunning()
    }
    const startService = async () => {
        await checkService()
        if (serviceReady.value) {
            loading.value = false
            return
        }

        try {
            const accessToken = await getToken('lz.access_token') ?? ''
            const a = await StartService('wss://dev.lagzap.network', accessToken);
            console.log(a)
            ndisRunning.value = await IsNDISRunning()
            const wasNdisRunning = ndisRunning.value;
            await checkNDIS();
            if (!ndisRunning.value && wasNdisRunning) {
                await startNDIS();
            }
        } catch (e) {
            error.value = true
            statusMessage.value = e.getMessage()
            console.error(e)
            throw e
        } finally {
            await checkService()
        }
    }
    const stopService = async () => {
        loading.value = true
        error.value = false
        statusMessage.value = 'Stopping service'
        await checkService()
        if (!serviceReady.value) {
            loading.value = false
            return
        }

        try {
            await StopService();
            statusMessage.value = 'Service stopped'
        } catch (e) {
            error.value = true
            statusMessage.value = 'Service has failed to stop!'
        } finally {
            await checkService()
            loading.value = false
        }
    }

    // NDIS
    const checkNDIS = async () => {
        ndisRunning.value = await IsNDISRunning()
    }
    const startNDIS = async () => {
        const isRunning = await IsNDISRunning()
        if (isRunning) await StopNDIS()

        // const processRegex = Object.values(this.activeTitles)
        // if (processRegex.length > 0) {
        //     processRegex.push('^C:\\\\Windows\\\\System32\\\\svchost\\.exe$')
        // }
        
        const options = new StartNdisOptions({
            // process_tcp: processRegex as Array<string>,
            // process_udp: processRegex as Array<string>,
        });
        await StartNDIS(options);
        ndisRunning.value = await IsNDISRunning()

    }
    const stopNDIS = async () => {
        await StopNDIS();
        ndisRunning.value = await IsNDISRunning()
    }
    const toggleNDIS = async () => {
        ndisRunning.value = await IsNDISRunning()
        if (ndisRunning.value) {
            await stopNDIS();
        } else {
            await startNDIS();
        }
    }

    // network analysis
    const optimize = async () => {
        optimizing.value = true
        echo.value = await GetOptimizeResults();
        optimizing.value = false
    }
    const updateEcho = async () => {
        echo.value = await GetOptimizeResults();
    }
    const pingNode = async (tag: string) => {
        const result = await TestSpecificNode(tag)
        const [nodeResult] = result
        echo.value[tag] = nodeResult
        return nodeResult
    }

    return {
        // State
        abilities,
        displayLimit,
        loading,
        driverInstalled,
        statusMessage,
        error,
        optimizing,
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
        getActiveProfilesForTitle,
        
        // Actions
        initialize,
        toggleActiveState,
        setDisplayLimit,
        isTitleActive,
        isProfileActive,
        activateTitle,
        deactivateTitle,
        activateProfile,
        deactivateProfile,
        visitTitle,
        upsertTitles,
        upsertProfiles,
        upsertRegions,
        upsertNodes,
        deleteTitle,
        deleteProfile,
        deleteRegion,
        deleteNode,
        findTitleByProcessRegex,
        findProfileByProcessRegex,
        setDefaultProfiles,
        activeDefaultProfile,
        checkService,
        startService,
        stopService,
        checkNDIS,
        startNDIS,
        stopNDIS,
        toggleNDIS,
        optimize,
        updateEcho,
        pingNode
    }
})
