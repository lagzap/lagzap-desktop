import {defineStore} from 'pinia'
import { string } from 'zod';
import {HeadlessRule, Region as RegionServer, Node as NodeServer, StartNdisOptions} from '~/bindings/github.com/lagzap/lagzap-desktop';
import {
    AddProcess,
    GetLatency,
    DeviceHash,
    IsNDISRunning,
    IsRunning,
    Nodes,
    RemoveProcess,
    StartNDIS, StartService,
    StopNDIS,
    StopService
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

    authenticated: boolean
    serviceReady: boolean
    ndisRunning: boolean

    nodes: Node[]
    regions: Region[]

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

        authenticated: false,
        serviceReady: false,
        ndisRunning: false,
        recentTitles: {},

        regions: [],
        nodes: [],

        deviceHash: '',
        defaultOutbound: 'global',
        nodeLatencies: {},
    }),
    getters: {
        getTitles: (state) => () => {
            const data = useSanctumUser<DataResponse>()
            const activeTitles = data.value.titles
                .filter(title => state.activeTitles.includes(title.id))
                .sort((a, b) => (state.recentTitles[b.id] || 0) - (state.recentTitles[a.id] || 0));
            const inactiveTitles = data.value.titles
                .filter(title => !state.activeTitles.includes(title.id))
                .sort((a, b) => (state.recentTitles[b.id] || 0) - (state.recentTitles[a.id] || 0));
            return [...activeTitles, ...inactiveTitles];
        },
        getRecentTitles: (state) => () => {
            const data = useSanctumUser<DataResponse>()
            const activeTitles = data.value.titles
                .filter(title => state.activeTitles.includes(title.id))
                .sort((a, b) => (state.recentTitles[b.id] || 0) - (state.recentTitles[a.id] || 0))
                .slice(0, state.displayLimit);
            const inactiveTitles = data.value.titles
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
                this.statusMessage = "Processing data";
                await this.applyData()

                this.statusMessage = "Authenticating";

                this.deviceHash = await DeviceHash()
                this.authenticated = false
                try {
                    await this.authenticate()
                } catch (err) {
                    this.authenticated = false
                }

                this.statusMessage = "Preparing service";
                await this.checkService();
                if (!this.serviceReady) {
                    this.statusMessage = "Starting service";
                    await this.startService();
                }
                await GetLatency(true)
        
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
                console.error(err)
                this.error = true
                throw err
            } finally {
                this.loading = false
            }
        },
        async authenticate() {
            const runtimeConfig = useRuntimeConfig()
            const { data } = await useSanctumFetch(`/authenticate/${this.deviceHash}`, {
                method: 'POST',
                baseURL: runtimeConfig.public.coordinatorUrl,
                retry: 5,
                retryDelay: 60 * 1000,
            })
            console.log(data.value)
            this.authenticated = true
        },
        async applyData() {
            try {
                const data = useSanctumUser<DataResponse>()
                this.activeTitles = data.value.active_titles || []
                this.recentTitles = data.value.recent_titles || {}
                this.abilities = data.value.abilities || []
                this.regions = data.value.regions || []
                this.nodes = data.value.nodes || []
            } catch (err) {
                displayError(err)
                throw err
            }
        },

        // Active Titles
        async toggleActiveState(title: Title) {
            if (this.isTitleActive(title.id)) {
                await this.deactivateTitle(title.id);
                if (this.ndisRunning) {
                    await RemoveProcess(title.process_regex, true, true);
                }
            } else {
                await this.activateTitle(title.id);
                if (this.ndisRunning) {
                    await AddProcess(title.process_regex, true, true);
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
            
            const runtimeConfig = useRuntimeConfig()
            this.activeTitles.push(id)
            try {
                await useSanctumFetch(`/title/${id}/activate`, {
                    method: 'POST',
                    baseURL: runtimeConfig.public.apiBaseUrl,
                    retry: 5,
                    retryDelay: 60 * 1000,
                    credentials: 'include'
                })
            } catch (e) {
                displayError(e)
            }
        },
        async deactivateTitle(id: string) {
            this.activeTitles = this.activeTitles.filter(title => title !== id)

            const runtimeConfig = useRuntimeConfig()
            try {
                await useSanctumFetch(`/title/${id}/deactivate`, {
                    method: 'POST',
                    baseURL: runtimeConfig.public.apiBaseUrl,
                    retry: 5,
                    retryDelay: 60 * 1000,
                })
            } catch (e) {
                displayError(e)
            }
        },
        async visitTitle(id: string) {
            const runtimeConfig = useRuntimeConfig()

            this.recentTitles[id] = Date.now();
            try {
                await useSanctumFetch(`/title/${id}/visit`, {
                    method: 'POST',
                    baseURL: runtimeConfig.public.apiBaseUrl,
                    retry: 5,
                    retryDelay: 60 * 1000,
                })
            } catch (e) {
                displayError(e)
            }
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

            const logLevel = this.abilities.includes('view log trace') || import.meta.env.DEV ? "trace" : "fatal"
            try {
                const ruleSet: HeadlessRule[] = [];
                const regions: RegionServer[] = [];
                const nodes: NodeServer[] = [];
                this.nodes.forEach((node) => {
                    const nodeServer = new NodeServer({
                        id: node.id,
                        region: node.region,
                        area: node.area,
                        name: node.name,
                        country: node.country,
                        city: node.city,
                        latitude: node.latitude,
                        longitude: node.longitude,
                        ipv4: node.ipv4,
                        ipv6: node.ipv6 || null
                    });
                    nodes.push(nodeServer);
                })
                this.regions.forEach((region) => {
                    const regionServer = new RegionServer({
                        tag: region.tag,
                        name: region.name,
                        host: region.host,
                        active: region.active,
                    });
                    regions.push(regionServer);
                })
                await StartService(logLevel, regions, nodes, ruleSet);
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

        async updateLatency() {
            this.nodeLatencies = await Nodes();
            console.log(this.nodeLatencies)
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
