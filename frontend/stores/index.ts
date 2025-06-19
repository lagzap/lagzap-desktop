import {defineStore} from 'pinia'
import {StartNdisOptions} from '~/bindings/github.com/lagzap/lagzap-desktop';
import {
    AddProcess,
    GetLatency,
    DeviceHash,
    IsNDISRunning,
    IsRunning,
    Nodes,
    RemoveProcess,
    StartNDIS,
    StartService,
    StopNDIS,
    StopService,
    DeviceInfo,
    SetAccessToken,
    SetCoordinatorURL,
    ActionTitle,
    SetProxyURL
} from '~/bindings/github.com/lagzap/lagzap-desktop/service';
import type { EchoResult } from '~/bindings/github.com/lagzap/lagzap/adapter';

interface State {
    abilities: string[]

    displayLimit: number
    activeTitles: string[]
    recentTitles: Record<string, number>

    loading: boolean
    driverInstalled: boolean | null
    statusMessage: string
    error: boolean
    optimizing: boolean

    authenticated: boolean
    serviceReady: boolean
    ndisRunning: boolean

    titles: Record<string, Title>
    profiles: Record<string, Profile>
    nodes: Record<string, Node>
    regions: Record<string, Region>

    coordinateUrl: string | null
    proxyUrl: string | null
    deviceHash: string
    defaultOutbound: string | 'global'
    nodeLatencies: Record<string, EchoResult>
}

export const useStore = defineStore('index', {
    state: (): State => ({
        abilities: [],

        displayLimit: 10,
        activeTitles: [],

        loading: false,
        driverInstalled: null,
        statusMessage: "Initializing",
        error: false,
        optimizing: true,

        authenticated: false,
        serviceReady: false,
        ndisRunning: false,
        recentTitles: {},

        titles: {},
        profiles: {},
        regions: {},
        nodes: {},

        coordinateUrl: null,
        proxyUrl: null,
        deviceHash: '',
        defaultOutbound: 'global',
        nodeLatencies: {},
    }),
    getters: {
        getTitles: (state) => () => {
            const activeTitles = Object.values(state.titles)
                .filter(title => state.activeTitles.includes(title.id))
                .sort((a, b) => (state.recentTitles[b.id] || 0) - (state.recentTitles[a.id] || 0));
            const inactiveTitles = Object.values(state.titles)
                .filter(title => !state.activeTitles.includes(title.id))
                .sort((a, b) => (state.recentTitles[b.id] || 0) - (state.recentTitles[a.id] || 0));
            return [...activeTitles, ...inactiveTitles];
        },
        getRecentTitles: (state) => () => {
            const activeTitles = Object.values(state.titles)
                .filter(title => state.activeTitles.includes(title.id))
                .sort((a, b) => (state.recentTitles[b.id] || 0) - (state.recentTitles[a.id] || 0))
                .slice(0, state.displayLimit);
            const inactiveTitles = Object.values(state.titles)
                .filter(title => !state.activeTitles.includes(title.id))
                .sort((a, b) => (state.recentTitles[b.id] || 0) - (state.recentTitles[a.id] || 0))
                .slice(0, state.displayLimit);

            const titles = [...activeTitles, ...inactiveTitles];
            return state.displayLimit > 0 ? titles.slice(0, state.displayLimit) : titles;
        }
    },
    actions: {
        async initialize(callback?: (() => void)) {
            this.loading = true;
            this.error = false
            
            try {
                this.statusMessage = "Authenticating";
                this.deviceHash = await DeviceHash()
                const data = useSanctumUser<DataResponse>()
                this.abilities = data.value.abilities || []
                this.activeTitles = data.value.active_titles || []
                this.recentTitles = data.value.recent_titles || {}

                try {
                    this.authenticated = false
                    
                    const deviceInfo = await DeviceInfo()
                    const runtimeConfig = useRuntimeConfig()
                    const { data, status, error } = await useSanctumFetch<SessionResponse>(`/device/${this.deviceHash}`, {
                        method: 'POST',
                        baseURL: runtimeConfig.public.authBaseUrl,
                        retry: 100,
                        retryDelay: 5 * 1000,
                        body: deviceInfo
                    })

                    if (status.value == 'success') {
                        this.authenticated = true
                        this.coordinateUrl = data.value.coordinator
                        this.proxyUrl = data.value.proxy
                        const accessToken = await getToken('lz.access_token') ?? ''
                        await SetAccessToken(accessToken)
                        await SetCoordinatorURL(this.coordinateUrl)
                        await SetProxyURL(this.proxyUrl)
                    } else {
                        this.statusMessage = getErrorMessage(error.value)
                        this.error = true
                        this.authenticated = false
                    }
                } catch (err) {
                    this.authenticated = false
                } finally {
                    if (this.authenticated === false) {
                        return
                    }
                }

                this.statusMessage = "Preparing service";
                await this.checkService();
                if (!this.serviceReady) {
                    this.statusMessage = "Starting service";
                    await this.startService();
                }
        
                this.driverInstalled = true
                this.statusMessage = "LagZap is Ready!";
                if (callback !== undefined) {
                    callback()
                }
            } catch (err) {
                if (err.message.includes('initialize ndiapi')) {
                    this.driverInstalled = false
                    this.statusMessage = "The LagZap driver must be installed for the application to function properly. Please install the driver.";
                } else {
                    this.statusMessage = "Could not start the service!";
                }
                this.error = true
                throw err
            } finally {
                this.loading = false
            }
        },

        // Active Titles
        async toggleActiveState(title: Title) {
            if (this.isTitleActive(title.id)) {
                await this.deactivateTitle(title.id);
                if (this.ndisRunning) {
                    const titleObj = this.titles[title.id];
                    if (titleObj && titleObj.profiles) {
                        const removePromises = Object.values(titleObj.profiles)
                            .map(profile => RemoveProcess(profile.process_regex, true, true));
                        await Promise.allSettled(removePromises);
                    }
                }
            } else {
                await this.activateTitle(title.id);
                if (this.ndisRunning) {
                    if (title.profiles) {
                        const addPromises = Object.values(title.profiles)
                            .map(profile => AddProcess(profile.process_regex, true, true));
                        await Promise.allSettled(addPromises);
                    }
                }
            }
        },
        setDisplayLimit(limit: number) {
            this.displayLimit = limit;
        },
        isTitleActive(id: string): boolean {
            return this.activeTitles.includes(id);
        },
        async activateTitle(id: string) {
            if (this.isTitleActive(id)) {
                return
            }

            this.activeTitles.push(id)
            try {
                await ActionTitle(id, "activate")
            } catch (e) {
                displayError(e)
            }
        },
        async deactivateTitle(id: string) {
            this.activeTitles = this.activeTitles.filter(title => title !== id)
            try {
                await ActionTitle(id, "deactivate")
            } catch (e) {
                displayError(e)
            }
        },
        async visitTitle(id: string) {
            this.recentTitles[id] = Date.now();
            try {
                await ActionTitle(id, "visit")
            } catch (e) {
                displayError(e)
            }
        },
        upsertTitles(titles: Title[]) {
            for (const title of titles) {
                this.titles[title.id] = title;
                if (title.profiles && Array.isArray(title.profiles)) {
                    for (const profile of title.profiles) {
                        this.profiles[profile.id] = profile;
                    }
                }
            }
        },
        upsertRegions(regions: Record<string, Region>) {
            for (const [tag, region] of Object.entries(regions)) {
                this.regions[tag] = { ...this.regions[tag], ...region };
            }
        },
        upsertNodes(nodes: Record<string, Node>) {
            for (const [id, node] of Object.entries(nodes)) {
                this.nodes[id] = { ...this.nodes[id], ...node };
            }
        },
        findTitleByProcessRegex(processRegex: string): Title | undefined {
            // Find the profile with the given process_regex
            const profileEntry = Object.entries(this.profiles).find(
                ([, profile]) => profile.process_regex === processRegex
            );
            if (!profileEntry) return undefined;
            const [profileId, profile] = profileEntry;

            // Find the parent title that contains this profile
            return Object.values(this.titles).find(title => title.profiles[profileId]);
        },
        findProfileByProcessRegex(processRegex: string): Profile | undefined {
            return Object.values(this.profiles).find(
            (profile) => profile.process_regex === processRegex
            );
        },

        // Service
        async checkService() {
            this.serviceReady = await IsRunning()
            this.ndisRunning = await IsNDISRunning()
        },
        async startService() {
            await this.checkService()
            if (this.serviceReady) {
                this.loading = false
                return
            }

            try {
                await StartService();
                this.ndisRunning = await IsNDISRunning()
                const wasNdisRunning = this.ndisRunning;
                await this.checkNDIS();
                if (!this.ndisRunning && wasNdisRunning) {
                    await this.startNDIS();
                }
            } catch (e) {
                console.error(e)
                throw e
            } finally {
                await this.checkService()
            }
        },
        async stopService() {
            this.loading = true
            this.error = false
            this.statusMessage = 'Stopping service'
            await this.checkService()
            if (!this.serviceReady) {
                this.loading = false
                return
            }

            try {
                await StopService();
                this.statusMessage = 'Service stopped'
            } catch (e) {
                this.error = true
                this.statusMessage = 'Service has failed to stop!'
            } finally {
                await this.checkService()
                this.loading = false
            }
        },

        // NDIS
        async checkNDIS() {
            this.ndisRunning = await IsNDISRunning()
        },
        async startNDIS() {
            const isRunning = await IsNDISRunning()
            if (isRunning) await StopNDIS()

            const processRegex = Object.values(this.activeTitles)
            if (processRegex.length > 0) {
                processRegex.push('^C:\\\\Windows\\\\System32\\\\svchost\\.exe$')
            }
            
            const options = new StartNdisOptions({
                process_tcp: processRegex as Array<string>,
                process_udp: processRegex as Array<string>,
            });
            await StartNDIS(options);
            this.ndisRunning = await IsNDISRunning()

        },
        async stopNDIS() {
            await StopNDIS();
            this.ndisRunning = await IsNDISRunning()
        },
        async toggleNDIS() {
            this.ndisRunning = await IsNDISRunning()
            if (this.ndisRunning) {
                await this.stopNDIS();
            } else {
                await this.startNDIS();
            }
        },

        async optimize() {
            this.optimizing = true
            await GetLatency(true)
            await this.updateLatency();
            this.optimizing = false
        },
        async updateLatency() {
            this.nodeLatencies = await Nodes();
        },
        setNodeLatency(tag: string, result: EchoResult | null) {
            if (result === null) {
                delete this.nodeLatencies[tag]
                return
            }
            this.nodeLatencies[tag] = result
        }
    }
})
