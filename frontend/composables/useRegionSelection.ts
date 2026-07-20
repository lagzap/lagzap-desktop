import { computed, ref, watch } from 'vue';
import { useStore } from '@/stores';
import { RoutingMode, type Node, type RelayRoute, NodeFlag } from '~/bindings/github.com/lagzap/zap/data';
import type { Profile } from '~/bindings/github.com/lagzap/zap/data';
import country from 'country-list-js';
import { debounce } from 'es-toolkit';
import { ProfileFlag } from '~/constants/profile';
import { useLocale } from 'vuetify';
import { FindAvailableInterfaces } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { nodeCityGroupKey, useNodeLocationLabel } from "~/composables/useNodeLocationLabel";
import {
  displayPingMsForRelay,
  displayScoreForRelay,
} from "~/composables/relayPingDisplay";
import { useMonitoringStore } from "~/stores/monitoring";

export function useRegionSelection(profile: Profile) {
  const store = useStore();
  const { routeProbeHistory } = useMonitoringStore();
  const { t } = useLocale();
  const { getCityGroupLabel, getCityGroupNodes, cityKeyForNode } =
    useNodeLocationLabel();

  /** Best live probe, else best path measured RTT — never routes[0] alone. */
  function lowestMsForRelayRoute(routeData: RelayRoute | null | undefined): number | null {
    if (!routeData) {
      return null;
    }
    return displayPingMsForRelay(
      routeData.tag,
      routeData,
      routeProbeHistory.value
    );
  }

  function bestScoreForRelayRoute(routeData: RelayRoute | null | undefined): number | null {
    return displayScoreForRelay(routeData);
  }
  
  // Reactive state
  const dialogOpen = ref(false);
  const searchQuery = ref('');
  const loadingInterfaces = ref(false);
  
  // Helper function to check if a node should be shown based on profile flags
  const shouldShowNode = (node: Node): boolean => {
    // Exclude nodes in maintenance mode - this is the strictest filter, applied first
    if ((node.flags & NodeFlag.NodeFlag_NODE_FLAG_MAINTENANCE) !== 0) {
      return false;
    }

    const profileFlags = profile.flags || 0;
    
    // Check which flags the profile has
    const hasGamePacketProfile = (profileFlags & ProfileFlag.GAME_PACKET) !== 0;
    const hasProxyProfile = (profileFlags & ProfileFlag.PROXY) !== 0;
    const hasBypassSanctionsProfile = (profileFlags & ProfileFlag.BYPASS_SANCTIONS) !== 0;
    const hasHighTrafficProfile = (profileFlags & ProfileFlag.HIGH_TRAFFIC) !== 0;
    
    // Check node flags
    const hasRelay = (node.flags & NodeFlag.NodeFlag_NODE_FLAG_RELAY) !== 0;
    const hasCdn = (node.flags & NodeFlag.NodeFlag_NODE_FLAG_CONTENT_DELIVERY) !== 0;
    
    // Filter out edge-only nodes (nodes without RELAY or CDN flags)
    // Edge nodes are just for forwarding proxy and shouldn't be shown in region selection
    if (!hasRelay && !hasCdn) {
      return false; // Edge-only node, don't show
    }
    
    // CDN nodes should only be shown if profile has HIGH_TRAFFIC flag
    if (hasCdn && !hasHighTrafficProfile) {
      return false; // CDN node but profile doesn't have HIGH_TRAFFIC, don't show
    }
    
    // If profile has no special routing flags, show all RELAY nodes (CDN already filtered above)
    if (!hasGamePacketProfile && !hasProxyProfile && !hasBypassSanctionsProfile && !hasHighTrafficProfile) {
      return hasRelay; // Show RELAY nodes only
    }
    
    // Check if node matches ANY of the profile's flags (OR logic)
    // If profile has GAME_PACKET, only show nodes with NODE_FLAG_ROUTE_GAME_PACKET AND NODE_FLAG_RELAY
    if (hasGamePacketProfile) {
      const hasGamePacketNode = (node.flags & NodeFlag.NodeFlag_NODE_FLAG_ROUTE_GAME_PACKET) !== 0;
      if (hasGamePacketNode && hasRelay) {
        return true;
      }
    }
    
    // If profile has PROXY, only show nodes with NODE_FLAG_ROUTE_PROXY
    if (hasProxyProfile && (node.flags & NodeFlag.NodeFlag_NODE_FLAG_ROUTE_PROXY) !== 0) {
      return true;
    }
    
    // If profile has BYPASS_SANCTIONS, only show nodes with NODE_FLAG_ROUTE_BYPASS_SANCTIONS
    if (hasBypassSanctionsProfile && (node.flags & NodeFlag.NodeFlag_NODE_FLAG_ROUTE_BYPASS_SANCTIONS) !== 0) {
      return true;
    }
    
    // If profile has HIGH_TRAFFIC, only show nodes with NODE_FLAG_ROUTE_HIGH_TRAFFIC
    // (CDN nodes are already allowed above if profile has HIGH_TRAFFIC)
    if (hasHighTrafficProfile && (node.flags & NodeFlag.NodeFlag_NODE_FLAG_ROUTE_HIGH_TRAFFIC) !== 0) {
      return true;
    }
    
    // If profile has any of these flags but node doesn't match any of them, don't show it
    return false;
  };
  
  const areas = computed(() => {
    return Object.values(store.nodes)
      .filter(shouldShowNode)
      .slice()
      .sort((a, b) => {
        const countryA = country.findByIso2(a.country)?.name || '';
        const countryB = country.findByIso2(b.country)?.name || '';
        return countryA.localeCompare(countryB);
      })
      .reduce((acc, node) => {
        const area = node.country;
        acc[area] = acc[area] || [];
        acc[area].push(node);
        acc[area].sort((a, b) => a.name.localeCompare(b.name));
        return acc;
      }, {} as Record<string, Node[]>);
  });

  const areasByRegion = computed(() => {
    const regionGroups: Record<string, Record<string, Node[]>> = {};
    Object.entries(areas.value).forEach(([area, nodes]) => {
      const regionTag = nodes[0]?.region;
      if (regionTag) {
        regionGroups[regionTag] = regionGroups[regionTag] || {};
        regionGroups[regionTag][area] = nodes;
      }
    });

    const sortedRegionGroups: Record<string, Record<string, Node[]>> = {};
    Object.values(store.regions).forEach((region: any) => {
      if (regionGroups[region.tag]) {
        sortedRegionGroups[region.tag] = regionGroups[region.tag];
      }
    });

    return sortedRegionGroups;
  });
  
  const regionCountryMap = computed(() => {
    const map: Record<string, string[]> = {};
    const regions = Object.values(store.regions);
    regions.forEach((r: any) => (map[r.tag] = []));
    
    for (const country of Object.keys(areas.value || {})) {
      const nodesForCountry = areas.value[country] || [];
      const nodeWithRegion = nodesForCountry.find(
        (n: any) => n.region !== undefined && n.region !== null
      );
      const regionTag = nodeWithRegion
        ? nodeWithRegion.region
        : nodesForCountry[0]?.region || '';
      if (!map[regionTag]) map[regionTag] = [];
      map[regionTag].push(country);
    }
    
    return map;
  });
  
  const cityMap = computed(() => {
    const map: Record<string, Node[]> = {};
    Object.values(areas.value || {}).forEach((nodes) => {
      nodes.forEach((n: Node) => {
        const cityKey = nodeCityGroupKey(n);
        map[cityKey] = map[cityKey] || [];
        map[cityKey].push(n);
      });
    });
    Object.values(map).forEach((arr) =>
      arr.sort((a, b) => a.name.localeCompare(b.name))
    );
    return map;
  });
  
  
  // Search functionality
  const matchesSearch = (text: string, query: string): boolean => {
    if (!query) return true;
    return text.toLowerCase().includes(query.toLowerCase());
  };
  
  const matchesLocalizedSearch = (
    localizedObj: Record<string, string> | undefined,
    query: string
  ): boolean => {
    if (!query || !localizedObj) return true;
    return Object.values(localizedObj).some((value) =>
      value.toLowerCase().includes(query.toLowerCase())
    );
  };
  
  const matchesAliasSearch = (
    alias: string | null | undefined,
    query: string
  ): boolean => {
    if (!query || !alias) return true;
    return alias.toLowerCase().includes(query.toLowerCase());
  };
  
  // Filtered data based on search
  const filteredRegions = computed(() => {
    const regions = Object.values(store.regions);
    if (!searchQuery.value) return regions;
    
    return regions.filter((region) => {
      const localizedName = store.localized(region.name);
      return (
        matchesSearch(localizedName, searchQuery.value) ||
        matchesLocalizedSearch(region.name, searchQuery.value) ||
        matchesAliasSearch((region as any).alias_name, searchQuery.value)
      );
    });
  });
  

  // Filtered region-country mapping for country mode
  const filteredRegionCountryMap = computed(() => {
    if (!searchQuery.value) return regionCountryMap.value;
    
    const filtered: Record<string, string[]> = {};
    
    Object.entries(regionCountryMap.value).forEach(([regionTag, countries]) => {
      const filteredCountries = countries.filter((countryCode) => {
        const countryName = country.findByIso2(countryCode)?.name || countryCode;
        return matchesSearch(countryName, searchQuery.value);
      });
      
      if (filteredCountries.length > 0) {
        filtered[regionTag] = filteredCountries;
      }
    });
    
    return filtered;
  });
  
  // Helper function to check if node has RELAY flag (same as network-latency.vue)
  const hasRelayFlag = (node: Node): boolean => {
    return (node.flags & NodeFlag.NodeFlag_NODE_FLAG_RELAY) !== 0;
  };

  // Ping calculation functions (based on network-latency.vue implementation)
  const getLowestPingForCountry = (nodes: Node[] | undefined): RelayRoute | null => {
    if (!nodes || nodes.length === 0) return null;

    let bestRoute: RelayRoute | null = null;
    let lowestLatency = Infinity;

    const variants = ["ipv4-udp", "ipv4-tcp", "ipv6-udp", "ipv6-tcp"];

    for (const node of nodes) {
      // Only consider nodes with RELAY flag
      if (!hasRelayFlag(node)) continue;
      
      for (const v of variants) {
        const key = `${node.id}-${v}`;
        const routeData: RelayRoute | undefined = (store.routes || {})[key];
        if (
          !routeData ||
          !Array.isArray(routeData.routes) ||
          routeData.routes.length === 0
        )
          continue;

        for (const route of routeData.routes) {
          const l = route?.min_latency;
          if (
            typeof l === "number" &&
            !Number.isNaN(l) &&
            l > 0 &&
            l < lowestLatency
          ) {
            lowestLatency = l;
            bestRoute = routeData;
          }
        }
      }
    }

    return bestRoute;
  };
  
  const getLowestPingForRegion = (regionTag: string): RelayRoute | null => {
    // Get all nodes in the region (same approach as network-latency.vue)
    const regionAreas = areasByRegion.value[regionTag] || {};
    const nodes: Node[] = [];
    Object.values(regionAreas).forEach((arr) => nodes.push(...arr));
    if (nodes.length === 0) return null;
    
    // Filter to only RELAY nodes
    const relayNodes = nodes.filter(hasRelayFlag);
    if (relayNodes.length === 0) return null;
    
    return getLowestPingForCountry(relayNodes);
  };
  
  const lowestPingForCity = (cityKeyOrLegacy: string): RelayRoute | null => {
    const cityKey = cityKeyForNode(cityKeyOrLegacy) ?? cityKeyOrLegacy;
    const nodes = cityMap.value[cityKey] ?? getCityGroupNodes(cityKey);
    return getLowestPingForCountry(nodes.filter(hasRelayFlag));
  };

  function profileSelectedCityKeys(profileState: {
    mode?: number;
    cities?: string[];
    node_id?: string | null;
  }): string[] {
    const keys = new Set<string>();

    for (const city of profileState.cities ?? []) {
      const resolved = cityKeyForNode(city) ?? city;
      keys.add(resolved);
    }

    if (profileState.node_id) {
      const resolved = cityKeyForNode(profileState.node_id);
      if (resolved) {
        keys.add(resolved);
      }
    }

    return [...keys];
  }

  const getCitySelected = (cityKey: string): boolean => {
    const pid = profile?.id;
    if (!pid) return false;
    const profileState = store.profileStates[pid];
    if (!profileState) return false;

    const isMultipath =
      (profile.flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET)) !== 0;
    const effectiveMode =
      profileState.mode ||
      (isMultipath
        ? RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL
        : RoutingMode.RoutingMode_ROUTING_MODE_NODE);

    if (effectiveMode === RoutingMode.RoutingMode_ROUTING_MODE_CITY) {
      return profileSelectedCityKeys(profileState).includes(cityKey);
    }

    if (effectiveMode === RoutingMode.RoutingMode_ROUTING_MODE_NODE) {
      const selectedKeys = profileSelectedCityKeys(profileState);
      if (selectedKeys.length === 0) {
        return false;
      }
      return selectedKeys.includes(cityKey);
    }

    return false;
  };

  const selectCity = (cityKey: string) => {
    const pid = profile?.id;
    if (!pid) return;

    store.profileStates[pid].node_id = null;
    store.profileStates[pid].cities = [cityKey];
    store.profileStates[pid].mode = RoutingMode.RoutingMode_ROUTING_MODE_CITY;
  };
  
  // City helper functions
  const getCityLabel = (cityKey: string): string => {
    return getCityGroupLabel(cityKey);
  };

  const firstNodeIdForCity = (cityKey: string): string => {
    const relayRoute = lowestPingForCity(cityKey);
    if (relayRoute?.tag) {
      return relayRoute.tag;
    }
    return cityMap.value[cityKey]?.[0]?.id || "";
  };

  const toggleRegion = (regionTag: string) => {
    const pid = profile?.id;
    if (!pid) return;
    const selected = new Set(
      store.profileStates[pid].regions || ([] as string[])
    );
    
    if (selected.has(regionTag)) {
      selected.delete(regionTag);
    } else {
      selected.add(regionTag);
      store.profileStates[pid].mode = RoutingMode.RoutingMode_ROUTING_MODE_REGIONAL;
    }
    
    store.profileStates[pid].regions = Array.from(selected);
  };
  
  const toggleCountry = (country: string) => {
    const pid = profile?.id;
    if (!pid) return;
    const selected = new Set(
      store.profileStates[pid].countries || ([] as string[])
    );
    
    if (selected.has(country)) {
      selected.delete(country);
    } else {
      selected.add(country);
      store.profileStates[pid].mode = RoutingMode.RoutingMode_ROUTING_MODE_COUNTRY;
    }
    
    store.profileStates[pid].countries = Array.from(selected);
  };
  
  const toggleCity = (city: string) => {
    const pid = profile?.id;
    if (!pid) return;
    const selected = new Set(store.profileStates[pid].cities || ([] as string[]));
    
    if (selected.has(city)) {
      selected.delete(city);
    } else {
      selected.add(city);
      store.profileStates[pid].mode = RoutingMode.RoutingMode_ROUTING_MODE_CITY;
    }
    
    store.profileStates[pid].cities = Array.from(selected);
  };
  
  // Select All functionality
  const allRegionsSelected = computed(() => {
    const pid = profile?.id;
    if (!pid) return false;
    const selected = store.profileStates[pid]?.regions || [];
    const allRegions = Object.values(store.regions);
    return selected.length === allRegions.length;
  });
  
  const someRegionsSelected = computed(() => {
    const pid = profile?.id;
    if (!pid) return false;
    const selected = store.profileStates[pid]?.regions || [];
    const allRegions = Object.values(store.regions);
    return selected.length > 0 && selected.length < allRegions.length;
  });
  
  const allCountriesSelected = computed(() => {
    const pid = profile?.id;
    if (!pid) return false;
    const selected = store.profileStates[pid]?.countries || [];
    const allCountries = Object.keys(areas.value || {});
    return selected.length === allCountries.length;
  });
  
  const someCountriesSelected = computed(() => {
    const pid = profile?.id;
    if (!pid) return false;
    const selected = store.profileStates[pid]?.countries || [];
    const allCountries = Object.keys(areas.value || {});
    return selected.length > 0 && selected.length < allCountries.length;
  });
  
  const allCitiesSelected = computed(() => {
    const pid = profile?.id;
    if (!pid) return false;
    const selected = store.profileStates[pid]?.cities || [];
    const allCities = Object.keys(cityMap.value || {});
    return selected.length === allCities.length;
  });
  
  const someCitiesSelected = computed(() => {
    const pid = profile?.id;
    if (!pid) return false;
    const selected = store.profileStates[pid]?.cities || [];
    const allCities = Object.keys(cityMap.value || {});
    return selected.length > 0 && selected.length < allCities.length;
  });
  
  const toggleAllRegions = () => {
    const pid = profile?.id;
    if (!pid) return;
    
    if (allRegionsSelected.value) {
      store.profileStates[pid].regions = [];
    } else {
      store.profileStates[pid].regions = Object.values(store.regions).map((r) => r.tag);
    }
  };
  
  const toggleAllCountries = () => {
    const pid = profile?.id;
    if (!pid) return;
    
    if (allCountriesSelected.value) {
      store.profileStates[pid].countries = [];
    } else {
      store.profileStates[pid].countries = [...Object.keys(areas.value || {})];
    }
  };
  
  const toggleAllCities = () => {
    const pid = profile?.id;
    if (!pid) return;
    
    if (allCitiesSelected.value) {
      store.profileStates[pid].cities = [];
    } else {
      store.profileStates[pid].cities = [...Object.keys(cityMap.value || {})];
    }
  };
  
  // Mode management
  const mode = computed<string>({
    get() {
      const m = store.profileStates[profile.id]?.mode;
      switch (m) {
        case RoutingMode.RoutingMode_ROUTING_MODE_REGIONAL:
          return 'region';
        case RoutingMode.RoutingMode_ROUTING_MODE_COUNTRY:
          return 'country';
        case RoutingMode.RoutingMode_ROUTING_MODE_CITY:
          return 'city';
        case RoutingMode.RoutingMode_ROUTING_MODE_DIRECT:
          return 'direct';
        default:
          return 'global';
      }
    },
    set(v: string) {
      if (v === 'region')
        store.profileStates[profile.id].mode =
          RoutingMode.RoutingMode_ROUTING_MODE_REGIONAL;
      else if (v === 'country')
        store.profileStates[profile.id].mode =
          RoutingMode.RoutingMode_ROUTING_MODE_COUNTRY;
      else if (v === 'city')
        store.profileStates[profile.id].mode =
          RoutingMode.RoutingMode_ROUTING_MODE_CITY;
      else if (v === 'direct')
        store.profileStates[profile.id].mode =
          RoutingMode.RoutingMode_ROUTING_MODE_DIRECT;
      else
        store.profileStates[profile.id].mode =
          RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL;
    },
  });

  // Node selection mode (for single node selection)
  const isNodeSelectionMode = computed(() => {
    return (profile.flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET)) === 0;
  });

  // Node data for single node selection
  const nodeMap = computed(() => {
    const map: Record<string, Node[]> = {};
    Object.values(store.nodes)
      .filter(shouldShowNode)
      .forEach((node) => {
        const nodeName = node.name;
        map[nodeName] = map[nodeName] || [];
        map[nodeName].push(node);
      });
    return map;
  });

  const nodeKeys = computed(() => Object.keys(nodeMap.value || {}));

  // Hierarchical node organization by region and country (for node selection mode)
  const nodeHierarchy = computed(() => {
    const hierarchy: Record<string, Record<string, string[]>> = {};

    Object.values(store.nodes)
      .filter(shouldShowNode)
      .forEach((node) => {
        const regionTag = node.region;
        const countryIso2 = node.country;
        const cityKey = nodeCityGroupKey(node);

        if (!hierarchy[regionTag]) {
          hierarchy[regionTag] = {};
        }

        if (!hierarchy[regionTag][countryIso2]) {
          hierarchy[regionTag][countryIso2] = [];
        }

        if (!hierarchy[regionTag][countryIso2].includes(cityKey)) {
          hierarchy[regionTag][countryIso2].push(cityKey);
        }
      });

    return hierarchy;
  });

  // Get sorted region tags by lowest ping
  const getSortedRegionTags = (): string[] => {
    const regionTags = Object.keys(nodeHierarchy.value);
    
    // Create a map of region tags to their lowest ping
    const regionPings = new Map<string, number>();
    
    regionTags.forEach(regionTag => {
      let lowestPing = Infinity;
      
      // Find the lowest ping across all nodes in this region
      Object.values(nodeHierarchy.value[regionTag]).forEach((countryCities) => {
        countryCities.forEach((cityKey) => {
          const ping = lowestPingForCity(cityKey);
          const ms = lowestMsForRelayRoute(ping);
          if (ms != null && ms < lowestPing) {
            lowestPing = ms;
          }
        });
      });
      
      if (lowestPing !== Infinity) {
        regionPings.set(regionTag, lowestPing);
      }
    });
    
    return regionTags.sort((a, b) => {
      const pingA = regionPings.get(a);
      const pingB = regionPings.get(b);
      
      // If both have pings, sort by latency (lowest first)
      if (pingA !== undefined && pingB !== undefined) {
        return pingA - pingB;
      }
      
      // If only one has ping, prioritize it
      if (pingA !== undefined && pingB === undefined) return -1;
      if (pingB !== undefined && pingA === undefined) return 1;
      
      // If neither has ping, sort alphabetically
      return a.localeCompare(b);
    });
  };

  // Get sorted nodes for a specific region and country (for node selection mode)
  const getSortedNodesForCountry = (
    regionTag: string,
    countryIso2: string
  ): string[] => {
    const cityKeys = nodeHierarchy.value[regionTag]?.[countryIso2] || [];
    const cityPings = new Map<string, number>();

    cityKeys.forEach((cityKey) => {
      const ping = lowestPingForCity(cityKey);
      const ms = lowestMsForRelayRoute(ping);
      if (ms != null) {
        cityPings.set(cityKey, ms);
      }
    });

    return cityKeys.sort((a, b) => {
      const pingA = cityPings.get(a);
      const pingB = cityPings.get(b);

      if (pingA !== undefined && pingB !== undefined) {
        return pingA - pingB;
      }

      if (pingA !== undefined && pingB === undefined) return -1;
      if (pingB !== undefined && pingA === undefined) return 1;

      return getCityLabel(a).localeCompare(getCityLabel(b));
    });
  };

  const getFilteredRegionTags = (): string[] => {
    if (!searchQuery.value) return getSortedRegionTags();
    
    const regionTags = Object.keys(nodeHierarchy.value);
    return regionTags.filter(regionTag => {
      const region = store.regions[regionTag];
      if (!region) return false;
      
      const regionName = store.localized(region.name);
      if (matchesSearch(regionName, searchQuery.value)) return true;
      
      // Check if any nodes in this region match the search
      const countries = Object.keys(nodeHierarchy.value[regionTag] || {});
      for (const countryIso2 of countries) {
        const nodes = nodeHierarchy.value[regionTag][countryIso2] || [];
        for (const cityKey of nodes) {
          const cityLabel = getCityLabel(cityKey);
          if (matchesSearch(cityLabel, searchQuery.value)) return true;
        }
      }
      return false;
    }).sort((a, b) => {
      const regionA = store.regions[a];
      const regionB = store.regions[b];
      if (!regionA || !regionB) return 0;
      
      const nameA = store.localized(regionA.name);
      const nameB = store.localized(regionB.name);
      return nameA.localeCompare(nameB);
    });
  };

  const getFilteredNodesForCountry = (regionTag: string, countryIso2: string): string[] => {
    const allNodes = getSortedNodesForCountry(regionTag, countryIso2);
    if (!searchQuery.value) return allNodes;
    
    return allNodes.filter((cityKey) => {
      const cityLabel = getCityLabel(cityKey);
      return matchesSearch(cityLabel, searchQuery.value);
    });
  };

  // Interface-related computed properties and functions
  const interfaces = computed(() => store.availableInterfaces);
  const availableInterfaceNames = computed(() => store.availableInterfaceNames);
  const selectedDefaultInterface = computed(
    () => store.profileStates[profile.id]?.default_interface || null
  );
  const orphanedInterfaces = computed(() =>
    store.getUnavailableInterfaces(profile.id)
  );

  const updateInterfaces = async () => {
    if (loadingInterfaces.value) return;
    loadingInterfaces.value = true;
    await FindAvailableInterfaces();
    loadingInterfaces.value = false;
  };

  // Hierarchical city organization by region and country (for city mode)
  const cityHierarchy = computed(() => {
    const hierarchy: Record<string, Record<string, string[]>> = {};

    Object.values(store.nodes)
      .filter(shouldShowNode)
      .forEach((node) => {
        const regionTag = node.region;
        const countryIso2 = node.country;
        const cityKey = nodeCityGroupKey(node);

        if (!hierarchy[regionTag]) {
          hierarchy[regionTag] = {};
        }

        if (!hierarchy[regionTag][countryIso2]) {
          hierarchy[regionTag][countryIso2] = [];
        }

        if (!hierarchy[regionTag][countryIso2].includes(cityKey)) {
          hierarchy[regionTag][countryIso2].push(cityKey);
        }
      });

    return hierarchy;
  });

  // Get sorted cities for a specific region and country
  const getSortedCitiesForCountry = (
    regionTag: string,
    countryIso2: string
  ): string[] => {
    return getSortedNodesForCountry(regionTag, countryIso2);
  };

  // Region city selection helpers
  const getRegionCitiesSelected = (regionTag: string): boolean => {
    const cities = cityHierarchy.value[regionTag];
    if (!cities) return false;
    
    const allCities: string[] = [];
    Object.values(cities).forEach(countryCities => {
      allCities.push(...countryCities);
    });
    
    const selectedCities = store.profileStates[profile.id]?.cities || [];
    return allCities.length > 0 && allCities.every(city => selectedCities.includes(city));
  };

  const getRegionCitiesSomeSelected = (regionTag: string): boolean => {
    const cities = cityHierarchy.value[regionTag];
    if (!cities) return false;
    
    const allCities: string[] = [];
    Object.values(cities).forEach(countryCities => {
      allCities.push(...countryCities);
    });
    
    const selectedCities = store.profileStates[profile.id]?.cities || [];
    const selectedCount = allCities.filter(city => selectedCities.includes(city)).length;
    return selectedCount > 0 && selectedCount < allCities.length;
  };

  const toggleRegionCities = (regionTag: string) => {
    const cities = cityHierarchy.value[regionTag];
    if (!cities) return;
    
    const allCities: string[] = [];
    Object.values(cities).forEach(countryCities => {
      allCities.push(...countryCities);
    });
    
    const profileState = store.profileStates[profile.id];
    const selectedCities = profileState.cities || [];
    const isAllSelected = allCities.every(city => selectedCities.includes(city));
    
    if (isAllSelected) {
      // Deselect all cities in this region
      profileState.cities = selectedCities.filter(city => !allCities.includes(city));
    } else {
      // Select all cities in this region
      const newCities = [...new Set([...selectedCities, ...allCities])];
      profileState.cities = newCities;
    }
  };

  // Get localized region name
  const getRegionLocalizedName = (regionTag: string): string => {
    const regions = Object.values(store.regions);
    const region = regions.find(r => r.tag === regionTag);
    if (!region) return regionTag;
    
    try {
      const localizedName = store.localized(region.name);
      return localizedName || regionTag;
    } catch (e) {
      return regionTag;
    }
  };

  // Sorted regions by lowest ping
  const sortedRegions = computed(() => {
    const regionsList = [...Object.values(store.regions)];
    
    // Create a map of region tags to their ping latencies
    const regionPings = new Map<string, number>();
    
    regionsList.forEach(region => {
      const ping = getLowestPingForRegion(region.tag);
      const ms = lowestMsForRelayRoute(ping);
      if (ms != null) {
        regionPings.set(region.tag, ms);
      }
    });
    
    return regionsList.sort((a, b) => {
      const pingA = regionPings.get(a.tag);
      const pingB = regionPings.get(b.tag);
      
      // If both have pings, sort by latency (lowest first)
      if (pingA !== undefined && pingB !== undefined) {
        return pingA - pingB;
      }
      
      // If only one has ping, prioritize it
      if (pingA !== undefined && pingB === undefined) return -1;
      if (pingB !== undefined && pingA === undefined) return 1;
      
      // If neither has ping, sort alphabetically
      return a.tag.localeCompare(b.tag);
    });
  });



  // Node selection helpers (single selection)
  const getNodeSelected = (nodeName: string): boolean => {
    const pid = profile?.id;
    if (!pid) return false;
    const profileState = store.profileStates[pid];
    const selected = profileState?.node_id;
    const mode = profileState?.mode;
    
    // Check if this is a multipath profile
    const isMultipath = (profile.flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET)) !== 0;
    
    // Handle unset mode - default to global for multipath, automatic for non-multipath
    const effectiveMode = mode || (isMultipath ? RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL : RoutingMode.RoutingMode_ROUTING_MODE_NODE);
    
    // Handle automatic selection (empty string)
    if (nodeName === '') {
      if (isMultipath) {
        return effectiveMode === RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL;
      } else {
        // For non-multipath: automatic = node mode with null/undefined nodeId
        return effectiveMode === RoutingMode.RoutingMode_ROUTING_MODE_NODE && (selected === null || selected === undefined);
      }
    }
    
    // Handle direct mode
    if (nodeName === 'direct') {
      return effectiveMode === RoutingMode.RoutingMode_ROUTING_MODE_DIRECT;
    }
    
    // Handle specific city selection
    return getCitySelected(nodeName);
  };

  const selectNode = (nodeName: string) => {
    const pid = profile?.id;
    if (!pid) return;

    // Check if this is a multipath profile
    const isMultipath =
      (profile.flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET)) !== 0;

    if (isMultipath) {
      // For multipath profiles, use the original logic
      if (nodeName === "") {
        store.profileStates[pid].node_id = null;
        store.profileStates[pid].mode =
          RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL;
        return;
      }

      if (nodeName === "direct") {
        store.profileStates[pid].node_id = null;
        store.profileStates[pid].mode =
          RoutingMode.RoutingMode_ROUTING_MODE_DIRECT;
        return;
      }

      store.profileStates[pid].node_id = nodeName;
      store.profileStates[pid].mode = RoutingMode.RoutingMode_ROUTING_MODE_NODE;
    } else {
      // For non-multipath profiles: automatic = node mode with null nodeId, direct = direct mode
      if (nodeName === "") {
        store.profileStates[pid].node_id = null;
        store.profileStates[pid].cities = [];
        store.profileStates[pid].mode = RoutingMode.RoutingMode_ROUTING_MODE_NODE;
        return;
      }

      if (nodeName === "direct") {
        store.profileStates[pid].node_id = null;
        store.profileStates[pid].cities = [];
        store.profileStates[pid].mode =
          RoutingMode.RoutingMode_ROUTING_MODE_DIRECT;
        return;
      }

      selectCity(nodeName);
    }
  };

  // Node ping calculation (based on network-latency.vue implementation)
  const getLowestPingForNode = (nodeName: string): RelayRoute | null => {
    const nodes = nodeMap.value[nodeName];
    if (!nodes || nodes.length === 0) return null;
    
    // Filter to only RELAY nodes
    const relayNodes = nodes.filter(hasRelayFlag);
    if (relayNodes.length === 0) return null;
    
    return getLowestPingForCountry(relayNodes);
  };

  // Best ping based on current selection
  const bestPingForCurrentSelection = computed(() => {
    const pid = profile?.id;
    if (!pid) return null;
    
    // Explicitly reference store properties to ensure reactivity
    const profileState = store.profileStates[pid];
    const routes = store.routes;
    const nodes = store.nodes;
    
    if (!profileState) return null;
    
    const mode = profileState.mode;
    
    // Handle unset mode - default to global for multipath, automatic for non-multipath
    const isMultipath = (profile.flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET)) !== 0;
    const effectiveMode = mode || (isMultipath ? RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL : RoutingMode.RoutingMode_ROUTING_MODE_NODE);
    
    // For automatic mode (node mode with null nodeId OR global mode for multipath), find lowest ping among all nodes
    if ((effectiveMode === RoutingMode.RoutingMode_ROUTING_MODE_NODE && !profileState.node_id) || 
        effectiveMode === RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL) {
      let lowestPing = Infinity;
      let bestRoute: RelayRoute | null = null;
      
      // Check all nodes (filtered by profile flags)
      Object.values(nodes)
        .filter(shouldShowNode)
        .forEach(node => {
          const ping = getLowestPingForNode(node.name);
          const ms = lowestMsForRelayRoute(ping);
          if (ms != null && ms < lowestPing) {
            lowestPing = ms;
            bestRoute = ping;
          }
        });
      
      return bestRoute;
    }
    
    // For direct mode, return null (no ping to show)
    if (effectiveMode === RoutingMode.RoutingMode_ROUTING_MODE_DIRECT) {
      return null;
    }
    
    // For specific city selection, get ping for that city group
    if (
      effectiveMode === RoutingMode.RoutingMode_ROUTING_MODE_NODE &&
      profileState.node_id
    ) {
      const cityKey = cityKeyForNode(profileState.node_id);
      if (cityKey) {
        return lowestPingForCity(cityKey);
      }
      return getLowestPingForNode(profileState.node_id);
    }
    
    // For region mode
    if (effectiveMode === RoutingMode.RoutingMode_ROUTING_MODE_REGIONAL) {
      const regions = profileState.regions || [];
      if (regions.length === 0) return null;
      
      let lowestPing = Infinity;
      let bestRoute: RelayRoute | null = null;
      
      regions.forEach(regionTag => {
        const ping = getLowestPingForRegion(regionTag);
        const ms = lowestMsForRelayRoute(ping);
        if (ms != null && ms < lowestPing) {
          lowestPing = ms;
          bestRoute = ping;
        }
      });
      
      return bestRoute;
    }
    
    // For country mode
    if (effectiveMode === RoutingMode.RoutingMode_ROUTING_MODE_COUNTRY) {
      const countries = profileState.countries || [];
      if (countries.length === 0) return null;
      
      let lowestPing = Infinity;
      let bestRoute: RelayRoute | null = null;
      
      countries.forEach(countryCode => {
        const nodes = areas.value[countryCode] || [];
        const ping = getLowestPingForCountry(nodes);
        const ms = lowestMsForRelayRoute(ping);
        if (ms != null && ms < lowestPing) {
          lowestPing = ms;
          bestRoute = ping;
        }
      });
      
      return bestRoute;
    }
    
    // For city mode
    if (effectiveMode === RoutingMode.RoutingMode_ROUTING_MODE_CITY) {
      const cities = profileState.cities || [];
      if (cities.length === 0) return null;
      
      let lowestPing = Infinity;
      let bestRoute: RelayRoute | null = null;
      
      cities.forEach((citySelection) => {
        const ping = lowestPingForCity(citySelection);
        const ms = lowestMsForRelayRoute(ping);
        if (ms != null && ms < lowestPing) {
          lowestPing = ms;
          bestRoute = ping;
        }
      });
      
      return bestRoute;
    }
    
    return null;
  });

  const bestPingMsForCurrentSelection = computed(() =>
    lowestMsForRelayRoute(bestPingForCurrentSelection.value)
  );

  const bestPingScoreForCurrentSelection = computed(() =>
    bestScoreForRelayRoute(bestPingForCurrentSelection.value)
  );

  const getNodeCityLabel = (cityKeyOrNode: string): string => {
    const cityKey = cityKeyForNode(cityKeyOrNode) ?? cityKeyOrNode;
    return getCityLabel(cityKey);
  };

  function selectionCityLabel(profileState: {
    mode?: number;
    cities?: string[];
    node_id?: string | null;
  }): string | null {
    const selectedKeys = profileSelectedCityKeys(profileState);
    if (selectedKeys.length === 1) {
      return getCityLabel(selectedKeys[0]);
    }
    if (selectedKeys.length > 1) {
      return `${getCityLabel(selectedKeys[0])} +${selectedKeys.length - 1}`;
    }
    return null;
  }
  
  // Current selection text
  const currentSelectionText = computed(() => {
    const profileState = store.profileStates[profile.id];
    if (!profileState) return t('$vuetify.title.profile.server.global');
    
    const mode = profileState.mode;
    
    // Handle direct mode first (mode 10)
    if (mode === 10) {
      return t('$vuetify.title.profile.server.direct');
    }
    
    // Handle node selection mode
    if (isNodeSelectionMode.value) {
      return (
        selectionCityLabel(profileState) ??
        t('$vuetify.title.profile.server.automatic')
      );
    }
    
    // Handle unset mode - default to global for multipath, automatic for non-multipath
    if (!mode || mode === 0) {
      // Check if this is a multipath profile
      const isMultipath = (profile.flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET)) !== 0;
      if (isMultipath) {
        return t('$vuetify.title.profile.server.global');
      } else {
        return t('$vuetify.title.profile.server.automatic');
      }
    }
    
    if (mode === 1) {
      const regions = profileState.regions || [];
      if (regions.length === 0) return 'Global';
      if (regions.length === 1) {
        const region = store.regions[regions[0]];
        return region ? store.localized(region.name) : regions[0];
      }
      const firstRegion = store.regions[regions[0]];
      return `${store.localized(firstRegion?.name || {})} +${regions.length - 1}`;
    }
    
    if (mode === 2) {
      const countries = profileState.countries || [];
      if (countries.length === 0) return 'Global';
      if (countries.length === 1) {
        const countryName =
          country.findByIso2(countries[0])?.name || countries[0];
        return countryName;
      }
      const firstCountryName =
        country.findByIso2(countries[0])?.name || countries[0];
      return `${firstCountryName} +${countries.length - 1}`;
    }
    
    if (mode === 3) {
      const cities = profileState.cities || [];
      if (cities.length === 0) return 'Global';
      const cityLabel = selectionCityLabel(profileState);
      return cityLabel ?? 'Global';
    }

    if (mode === 4) {
      const nodeId = profileState.node_id;
      if (!nodeId) {
        return t('$vuetify.title.profile.server.automatic');
      }
      const cityKey = cityKeyForNode(nodeId);
      return cityKey
        ? getCityLabel(cityKey)
        : t('$vuetify.title.profile.server.automatic');
    }
    
    return t('$vuetify.title.profile.server.global');
  });

  // Auto-save functionality
  watch(
    () => store.profileStates[profile.id],
    debounce((newState) => {
      console.trace(store.profileStates[profile.id])
      store.saveProfileState(profile.id);
    }, 1000),
    { deep: true }
  );
  
  return {
    // State
    dialogOpen,
    searchQuery,
    
    // Computed data
    sortedRegions,
    areas,
    regionCountryMap,
    cityMap,
    
    // Node selection mode
    isNodeSelectionMode,
    nodeMap,
    nodeKeys,
    nodeHierarchy,
    getSortedNodesForCountry,
    getSortedRegionTags,
    getFilteredRegionTags,
    getFilteredNodesForCountry,
    
    // Interface-related
    interfaces,
    availableInterfaceNames,
    selectedDefaultInterface,
    orphanedInterfaces,
    loadingInterfaces,
    updateInterfaces,
    
    // City hierarchy (for city mode)
    cityHierarchy,
    getSortedCitiesForCountry,
    getRegionCitiesSelected,
    getRegionCitiesSomeSelected,
    toggleRegionCities,
    getRegionLocalizedName,
    
    // Filtered data
    filteredRegions,
    filteredRegionCountryMap,
    
    // Ping functions
    getLowestPingForCountry,
    getLowestPingForRegion,
    lowestPingForCity,
    getLowestPingForNode,
    bestPingForCurrentSelection,
    bestPingMsForCurrentSelection,
    bestPingScoreForCurrentSelection,
    
    // City helpers
    getCityLabel,
    firstNodeIdForCity,
    getNodeCityLabel,
    getCitySelected,
    selectCity,
    
    // Selection helpers
    getNodeSelected,
    
    // Toggle functions
    toggleRegion,
    toggleCountry,
    toggleCity,
    selectNode,
    
    // Select all state
    allRegionsSelected,
    someRegionsSelected,
    allCountriesSelected,
    someCountriesSelected,
    allCitiesSelected,
    someCitiesSelected,
    
    // Select all functions
    toggleAllRegions,
    toggleAllCountries,
    toggleAllCities,
    
    // Mode management
    mode,
    currentSelectionText,
  };
}
