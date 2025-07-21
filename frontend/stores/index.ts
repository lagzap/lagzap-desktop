import {defineStore} from 'pinia'
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
    GetEchoResults,
    TestSpecificNode,
    ActionProfile,
} from '~/bindings/github.com/lagzap/lagzap-desktop/service';
import type { NodeEchoResult } from '~/bindings/github.com/lagzap/lagzap/adapter';
import { ProfileFlag } from '~/constants/profile';

interface State {
    abilities: string[]

    displayLimit: number
    activeTitles: string[]
    activeProfiles: Record<string, string[]> // profileId: titleId[]
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

    echo: Record<string, NodeEchoResult>,

    defaultOutbound: string | 'global'
}

export const useStore = defineStore('index', {
    state: (): State => ({
        abilities: [],

        displayLimit: 10,
        activeTitles: [],
        activeProfiles: {},

        loading: false,
        driverInstalled: null,
        statusMessage: "Initializing",
        error: false,
        optimizing: false,

        authenticated: false,
        serviceReady: false,
        ndisRunning: false,
        recentTitles: {},

        titles: {},
        profiles: {},
        regions: {},
        nodes: {},

        echo: {},

        defaultOutbound: 'global',
    }),
    getters: {
        isReady: (state) => () => {
            return state.serviceReady;
        },
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
                this.statusMessage = "Preparing service";
                await this.checkService();
                if (!this.serviceReady) {
                    this.statusMessage = "Starting service";
                    await this.startService();
                }
                this.driverInstalled = true

                this.statusMessage = "Authenticating";
                const data = useSanctumUser<DataResponse>()
                this.abilities = data.value.abilities || []
                this.abilities = ['admin'] // TODO: temp
                this.activeTitles = data.value.active_titles || []
                this.recentTitles = data.value.recent_titles || {}
                this.activeProfiles = data.value.active_profiles || {}

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
        isProfileActive(id: string): boolean {
            return this.activeProfiles[id] !== undefined && this.activeProfiles[id].length > 0;
        },
        async activateTitle(id: string) {
            if (this.isTitleActive(id)) {
                return
            }
            this.activeTitles.push(id)
            this.setDefaultProfiles(id)
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
        async activateProfile(titleId: string, profileId: string) {
            if (!this.activeProfiles[profileId]) {
                this.activeProfiles[profileId] = [];
            }
            if (!this.activeProfiles[profileId].includes(titleId)) {
                this.activeProfiles[profileId].push(titleId);
            }
            try {
                await ActionProfile(titleId, profileId, "activate")
            } catch (e) {
                displayError(e)
            }
        },
        async deactivateProfile(titleId: string, profileId: string) {
            if (this.activeProfiles[profileId]) {
                this.activeProfiles[profileId] = this.activeProfiles[profileId].filter(id => id !== titleId);
                if (this.activeProfiles[profileId].length === 0) {
                    delete this.activeProfiles[profileId];
                }
            }
            try {
                await ActionProfile(titleId, profileId, "deactivate")
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
        upsertProfiles(profiles: Profile[]) {
            for (const profile of profiles) {
                this.profiles[profile.id] = profile;
                for (const title of Object.values(this.titles)) {
                    if (Array.isArray(title.profiles)) {
                        const idx = title.profiles.findIndex(p => p.id === profile.id);
                        if (idx !== -1) {
                            title.profiles[idx] = profile;
                        }
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
            this.updateEcho();
        },
        deleteTitle(id: string) {
            delete this.titles[id];
            this.activeTitles = this.activeTitles.filter(titleId => titleId !== id);
            delete this.recentTitles[id];
            if (this.titles[id]?.profiles) {
                for (const profileId of Object.keys(this.titles[id].profiles)) {
                    delete this.profiles[profileId];
                }
            }
        },
        deleteProfile(id: string) {
            delete this.profiles[id];
            delete this.activeProfiles[id];
            for (const title of Object.values(this.titles)) {
                title.profiles = title.profiles.filter(profile => profile.id !== id);
            }
        },
        deleteRegion(tag: string) {
            delete this.regions[tag];
        },
        deleteNode(id: string) {
            delete this.nodes[id];
            delete this.echo[id];
        },

        findTitleByProcessRegex(processRegex: string): Title | undefined {
            const profileEntry = Object.entries(this.profiles).find(
                ([, profile]) => profile.process_regex === processRegex
            );
            if (!profileEntry) return undefined;
            const [profileId] = profileEntry;
            return Object.values(this.titles).find(title => title.profiles && title.profiles[profileId]);
        },
        findProfileByProcessRegex(processRegex: string): Profile | undefined {
            return Object.values(this.profiles).find(
                (profile) => profile.process_regex === processRegex
            );
        },
        setDefaultProfiles(titleId: string) {
            const title = this.titles[titleId];
            if (!title || !title.profiles) {
                return;
            }
            const defaultProfiles = Object.values(title.profiles).filter(
                (profile) => profile.flags & ProfileFlag.DEFAULT_SELECTED
            );
            for (const profile of defaultProfiles) {
                if (!this.isProfileActive(profile.id)) {
                    this.activateProfile(titleId, profile.id);
                }
            }
        },
        activeDefaultProfile(titleId: string) {
            this.setDefaultProfiles(titleId);
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
                const accessToken = await getToken('lz.access_token') ?? ''
                const a = await StartService('wss://dev.lagzap.network', accessToken);
                console.log(a)
                this.ndisRunning = await IsNDISRunning()
                const wasNdisRunning = this.ndisRunning;
                await this.checkNDIS();
                if (!this.ndisRunning && wasNdisRunning) {
                    await this.startNDIS();
                }
            } catch (e) {
                this.error = true
                this.statusMessage = e.getMessage()
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

            // const processRegex = Object.values(this.activeTitles)
            // if (processRegex.length > 0) {
            //     processRegex.push('^C:\\\\Windows\\\\System32\\\\svchost\\.exe$')
            // }
            
            const options = new StartNdisOptions({
                // process_tcp: processRegex as Array<string>,
                // process_udp: processRegex as Array<string>,
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

        // network analysis
        async optimize() {
            this.optimizing = true
            this.echo = await GetEchoResults();
            this.optimizing = false
        },
        async updateEcho() {
            this.echo = await GetEchoResults();
        },
        async pingNode(tag: string) {
            const result = await TestSpecificNode(tag)
            const [nodeResult] = result
            this.echo[tag] = nodeResult
            return nodeResult
        }
    }
})
