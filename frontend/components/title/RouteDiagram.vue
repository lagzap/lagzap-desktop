<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch } from "vue";
import { useStore } from "~/stores";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import type { RelayRoute, NodeRoute } from "~/bindings/github.com/lagzap/zap/data";
import { useProfileDisplayRoutes } from "~/composables/useProfileDisplayRoutes";
import { useLocale } from "vuetify";
import * as echarts from "echarts";

const props = defineProps<{
  profile: Profile;
}>();

const store = useStore();
const { t } = useLocale();

const {
  shouldShowRoutes: shouldShowDiagram,
  numberOfRoutes,
  routeSlotCount,
  matchingRelayNodes,
  interfaceRouteGroups,
} = useProfileDisplayRoutes(computed(() => props.profile));

const selectedInterfaceIndex = ref(0);
const selectedCityForVisualization = ref<string | null>(null);
const showInterfaceSelector = computed(() => interfaceRouteGroups.value.length > 1);

const interfaceSelectItems = computed(() =>
  interfaceRouteGroups.value.map((group) => ({
    title: group.name,
    value: group.index,
  }))
);

const routesForSelectedInterface = computed(() => {
  const group = interfaceRouteGroups.value.find(
    (item) => item.index === selectedInterfaceIndex.value
  );
  return group?.routes ?? [];
});

const availableCities = computed(() => {
  const cities = new Set<string>();

  matchingRelayNodes.value.forEach((node) => {
    if (node.city) {
      const cityName = store.localized(node.city) as string;
      cities.add(cityName);
    }
  });

  return Array.from(cities).sort();
});

const visualizationRoutes = computed(() => {
  if (!selectedCityForVisualization.value) {
    return [];
  }

  const matchingNodes = Object.values(store.nodes).filter((node) => {
    const hasRelay = (node.flags & 0x1) !== 0;
    if (!hasRelay) return false;
    const cityName = store.localized(node.city) as string;
    return cityName === selectedCityForVisualization.value;
  });

  if (matchingNodes.length === 0) return [];

  let bestRelayRoute: RelayRoute | null = null;
  let lowestLatency = Infinity;
  const variants = ["ipv4-udp", "ipv4-tcp", "ipv6-udp", "ipv6-tcp"];

  for (const node of matchingNodes) {
    for (const v of variants) {
      const key = `${node.id}-${v}`;
      const routeData: RelayRoute | undefined = store.routes[key];
      if (
        !routeData ||
        !Array.isArray(routeData.routes) ||
        routeData.routes.length === 0
      ) {
        continue;
      }

      const firstRoute = routeData.routes[0];
      const latency = firstRoute?.min_latency;
      if (
        typeof latency === "number" &&
        !Number.isNaN(latency) &&
        latency > 0 &&
        latency < lowestLatency
      ) {
        lowestLatency = latency;
        bestRelayRoute = routeData;
      }
    }
  }

  if (!bestRelayRoute?.routes) return [];

  const routesArray = [...bestRelayRoute.routes] as NodeRoute[];
  routesArray.sort((a, b) => {
    const latencyA = a.min_latency || Infinity;
    const latencyB = b.min_latency || Infinity;
    return latencyA - latencyB;
  });

  return routesArray.slice(0, routeSlotCount.value);
});

const activeDiagramRoutes = computed(() => {
  if (selectedCityForVisualization.value) {
    return visualizationRoutes.value;
  }

  return routesForSelectedInterface.value;
});

watch(
  interfaceRouteGroups,
  (groups) => {
    if (groups.length === 0) {
      selectedInterfaceIndex.value = 0;
      return;
    }
    if (selectedInterfaceIndex.value >= groups.length) {
      selectedInterfaceIndex.value = 0;
    }
  },
  { immediate: true }
);

const chartRef = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

// Detect if we should use vertical layout for small screens
const useVerticalLayout = computed(() => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 800; // Use vertical layout for screens smaller than 800px
});

function updateChart() {
  if (!chart || !shouldShowDiagram.value) {
    return;
  }

  const routes = activeDiagramRoutes.value;
  if (routes.length === 0) {
    if (chart) {
      chart.setOption({
        series: [],
        backgroundColor: "transparent",
      });
    }
    return;
  }
  const maxHops = Math.max(
    ...routes.map((route) =>
      route.hops?.length == 1 ? 1 : route.hops?.length - 1 || 0
    )
  );

  // Calculate layout positions for clean grid-like structure
  const startX = 50; // More space from left edge
  const routeSpacing = 40; // Reduced space between routes
  const hopSpacing = 100; // Spacing between hops
  
  // Calculate dynamic center based on layout direction
  const totalRouteHeight = (routes.length - 1) * routeSpacing;
  const centerY = 0; // Keep center at 0, routes will be distributed around it
  const centerX = 0; // For vertical layout

  const nodes: any[] = [];
  const links: any[] = [];

  // Add user node (keep as circle)
  nodes.push({
    id: "user",
    name: "User",
    x: startX,
    y: centerY,
    symbolSize: 40,
    itemStyle: {
      color: "#2D2D2D",
      opacity: 1,
      borderWidth: 0,
    },
  });

  // Add main branch point from user - moved further right to spread out branches
  const branchPointId = "branch-point";
  const branchX = startX + hopSpacing / 3; // Moved closer to user to spread branches
  nodes.push({
    id: branchPointId,
    name: "",
    x: branchX,
    y: centerY,
    symbolSize: 0,
    itemStyle: { color: "transparent" },
    label: { show: false },
  });

  // Connect user to branch point
  links.push({
    source: "user",
    target: branchPointId,
    lineStyle: {
      color: "#424242",
      opacity: 1,
      width: 1,
      type: "solid",
    },
  });

  // Add route nodes and links with equal spacing
  routes.forEach((route, routeIndex) => {
    // Calculate centered positioning for routes
    const routeY = centerY - totalRouteHeight / 2 + routeIndex * routeSpacing;
    const hops = route.hops.length == 1 ? route.hops : route.hops.slice(0, -1);

    // Add hop nodes for this route with equal spacing
    // For routes with fewer hops, position them further right to use space better
    const routeOffset = ((maxHops - hops.length) * hopSpacing) / 2;
    hops.forEach((hop, hopIndex) => {
      const hopX = startX * 1.77777777 + (hopIndex + 1) * hopSpacing + routeOffset;
      const hopId = `route-${routeIndex}-hop-${hopIndex}`;

      // Find node information by IP
      let hopName = hop.ip || "Auto";
      let hopNode = null;

      if (hop.ip) {
        // Look up node by IP in store.nodes
        hopNode = Object.values(store.nodes).find(
          (node) => node.ipv4 === hop.ip || node.ipv6 === hop.ip
        );

        if (hopNode) {
          hopName = store.localized(hopNode.city) as string;
        }
      }

      // Calculate cumulative latency (sum of all previous hops up to this point)
      const cumulativeLatency = route.hops.slice(0, hopIndex + 1).reduce((sum, h) => sum + (h.latency || 0), 0);

      nodes.push({
        id: hopId,
        name: hopName,
        x: hopX - 24,
        y: routeY,
        offset: [0, 0],
        value: "hop", // Mark as hop node for tooltip
        label: {
          show: true,
          position: "inside",
          formatter: `{a|${hopName}}\n\n{b|IPv4 Route}`,
          rich: {
            a: {
              color: "#FFFFFF",
              fontSize: 11,
              lineHeight: 20,
            },
            b: {
              color: "#888888",
              fontSize: 9,
              lineHeight: 14,
            },
          },
        },
      });

      // Add link from previous node with angular path using waypoints
      if (hopIndex === 0) {
        // Create waypoint for angular path from branch point to first hop
        const waypointId = `waypoint-${routeIndex}-${hopIndex}`;
        const waypointX = branchX; // Same X as branch point

        // Add invisible waypoint node at the route's Y position with equal spacing
        nodes.push({
          id: waypointId,
          name: "",
          x: waypointX,
          y: routeY, // Use calculated routeY for equal spacing
          symbolSize: 0,
          itemStyle: { color: "transparent" },
          label: { show: false },
        });

        // Connect branch point -> waypoint (vertical line to route level)
        links.push({
          source: "branch-point",
          target: waypointId,
          lineStyle: {
            color: "#424242",
            opacity: 1,
            width: 1,
            type: "solid",
          },
        });
        // Show individual hop latency on label, cumulative in tooltip
        const firstHopLatency = route.hops[0]?.latency || 0;
        const firstHopCumulativeLatency = route.hops.slice(0, hopIndex + 1).reduce((sum, h) => sum + (h.latency || 0), 0);
        links.push({
          source: waypointId,
          target: hopId,
          value: firstHopCumulativeLatency, // Store cumulative latency for tooltip
          label: {
            show: true,
            position: "middle",
            formatter: `{a|${firstHopLatency}ms}`,
            rich: {
              a: {
                color: "#FFFFFF",
                backgroundColor: "rgba(0, 0, 0, 0.6)",
                borderColor: "rgba(255, 255, 255, 0.2)",
                borderWidth: 1,
                borderRadius: 4,
                padding: [3, 6, 2, 6],
                lineHeight: 16,
                textAlign: "center",
                verticalAlign: "middle",
              },
            },
            offset: [-11, 11],
          },
        });
      } else {
        const prevHopId = `route-${routeIndex}-hop-${hopIndex - 1}`;
        // Show individual hop latency on label, cumulative in tooltip
        const individualHopLatency = hop.latency || 0;
        const hopCumulativeLatency = route.hops.slice(0, hopIndex + 1).reduce((sum, h) => sum + (h.latency || 0), 0);
        links.push({
          source: prevHopId,
          target: hopId,
          value: hopCumulativeLatency, // Store cumulative latency for tooltip
          label: {
            show: true,
            position: "middle",
            formatter: `{a|${individualHopLatency}ms}`,
            rich: {
              a: {
                color: "#FFFFFF",
                backgroundColor: "rgba(0, 0, 0, 0.6)",
                borderColor: "rgba(255, 255, 255, 0.2)",
                borderWidth: 1,
                borderRadius: 4,
                padding: [3, 6, 2, 6],
                lineHeight: 16,
                textAlign: "center",
                verticalAlign: "middle",
              },
            },
            offset: [0, 11],
          },
        });
      }
    });

    if (hops.length > 0) {
      const lastHopId = `route-${routeIndex}-hop-${hops.length - 1}`;
      const waypointId = `waypoint-dest-${routeIndex}`;
      const waypointX = startX + (maxHops + 1) * hopSpacing;

      nodes.push({
        id: waypointId,
        name: "",
        x: waypointX,
        y: routeY, // Use routeY for proper vertical line
        symbolSize: 0,
        itemStyle: { color: "transparent" },
        label: { show: false },
      });

      // Show individual hop latency on label, cumulative in tooltip
      // For single hop, label shows 0ms but tooltip shows cumulative
      const finalHop = route.hops[route.hops.length - 1];
      const finalHopLatency = route.hops.length === 1 ? 0 : (finalHop?.latency || 0);
      const totalCumulativeLatency = route.hops.reduce((sum, hop) => sum + (hop?.latency || 0), 0);
      // Horizontal line AFTER final hop - this is where we show Avg, Min, Max, Score, Estimated Ping in tooltip
      links.push({
        source: lastHopId,
        target: waypointId,
        value: {
          avg: route.avg_latency || 0,
          min: route.min_latency || 0,
          max: route.max_latency || 0,
          score: route.score || 0,
          estimatedPing: route.min_latency || 0, // Estimated ping is min_latency
          isFinalLine: true, // Mark as final horizontal line after hop
        },
        label: {
          show: true,
          position: "middle",
          formatter: `{a|${finalHopLatency}ms}`,
          rich: {
            a: {
              color: "#FFFFFF",
              backgroundColor: "rgba(0, 0, 0, 0.6)",
              borderColor: "rgba(255, 255, 255, 0.2)",
              borderWidth: 1,
              borderRadius: 4,
              padding: [3, 6, 2, 6],
            },
          },
          offset: [11, 11],
        },
      });
      // Vertical convergence line (no special tooltip)
      links.push({
        source: waypointId,
        target: "dest-convergence",
        lineStyle: {
          color: "#424242",
          opacity: 1,
          width: 1,
          type: "solid",
        },
      });
    } else {
      // If no hops, connect directly from user to destination
      links.push({
        source: "user",
        target: "destination",
        lineStyle: {
          color: "#424242",
          opacity: 1,
          width: 1,
          type: "solid",
        },
      });
    }
  });

  // Add destination convergence point (like branch point on user side)
  const destConvergenceId = "dest-convergence";
  const destConvergenceX = startX + (maxHops + 1) * hopSpacing; // Position at the rightmost route
  nodes.push({
    id: destConvergenceId,
    name: "",
    x: destConvergenceX,
    y: centerY,
    symbolSize: 0,
    itemStyle: { color: "transparent" },
    label: { show: false },
  });

  const profileState = store.profileStates[props.profile.id];
  let destinationName = "Dest";
  let estimatedPing: number | null = null;
  
  if (routes.length > 0) {
    const bestRoute = routes[0];
    estimatedPing = bestRoute.min_latency || null;
    if (bestRoute.hops && bestRoute.hops.length > 0) {
      const lastHop = bestRoute.hops[bestRoute.hops.length - 1];
      if (lastHop?.ip) {
        const destinationNode = Object.values(store.nodes).find(
          (node) => node.ipv4 === lastHop.ip || node.ipv6 === lastHop.ip
        );
        if (destinationNode) {
          destinationName = store.localized(destinationNode.city) as string;
        }
      }
    }
  }

  nodes.push({
    id: "destination",
    name: "Dest",
    x: destConvergenceX + 30,
    y: centerY,
    value: estimatedPing, // Store estimated ping for tooltip
    label: {
      offset: [0, 0],
      show: true,
      position: "inside",
      formatter: `{a|${destinationName}}\n\n{b|IPv4 Route}`,
      rich: {
        a: {
          color: "#FFFFFF",
          fontSize: 11,
          lineHeight: 20,
        },
        b: {
          color: "#888888",
          fontSize: 9,
          lineHeight: 14,
        },
      },
    },
  });

  // Connect destination convergence point to destination
  links.push({
    source: destConvergenceId,
    target: "destination",
    lineStyle: {
      color: "#424242",
      opacity: 1,
      width: 1, // Normal width
      type: "solid",
    },
  });


  // Add game server node after destination with proper spacing
  nodes.push({
    id: "game-server",
    name: "Game",
    x: destConvergenceX + 70, // Proper spacing from destination
    y: centerY,
    symbolSize: 0, // Make it invisible
    itemStyle: { color: "transparent" },
    label: {
      show: true,
      position: "inside",
      formatter: `{icon|}`,
      rich: {
        icon: {
          backgroundColor: {
            image:
              store.titles.find((x) => x.id == props.profile.title_id)
                ?.icon_url || "",
          },
          width: 40,
          height: 40,
        },
      },
    },
  });

  // Connect destination to game server
  links.push({
    source: "destination",
    target: "game-server",
    lineStyle: {
      color: "#424242",
      opacity: 1,
      width: 1,
      type: "solid",
    },
  });

  const option = {
    grid: {
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      containLabel: false,
    },
    tooltip: {
      show: true,
      trigger: "item",
      formatter: (params: any) => {
        // Show tooltip ONLY for horizontal line AFTER final hop (from lastHopId to waypointId)
        // This link has isFinalLine: true and object value with avg, min, max, score, estimatedPing
        if (params.dataType === "edge" && 
            params.value && 
            typeof params.value === "object" && 
            params.value.isFinalLine === true &&
            params.value.avg !== undefined) {
          const { avg, min, max, score, estimatedPing } = params.value;
          return `Estimated Ping: ${estimatedPing}ms<br/>` +
                 `Avg: ${avg}ms<br/>` +
                 `Min: ${min}ms<br/>` +
                 `Max: ${max}ms<br/>` +
                 `Score: ${score}`;
        }
        // Show tooltip for other links with cumulative latency (number value, NOT object)
        if (params.dataType === "edge" && typeof params.value === "number") {
          return `Route Latency: ${params.value}ms`;
        }
        // Show tooltip for destination node (final node before game icon) with estimated ping
        if (params.dataType === "node" && params.data && params.data.id === "destination" && params.value !== null && params.value !== undefined) {
          return `Estimated Ping: ${params.value}ms`;
        }
        // No tooltip for anything else (including hop nodes, vertical lines, etc.)
        return "";
      },
      backgroundColor: "rgba(0, 0, 0, 0.8)",
      borderColor: "rgba(255, 255, 255, 0.2)",
      borderWidth: 1,
      textStyle: {
        color: "#FFFFFF",
        fontSize: 12,
      },
      padding: [8, 12],
    },
    series: [
      {
        type: "graph",
        layout: "none",
        data: nodes,
        links: links,
        roam: false,
        label: {
          show: true,
          position: "inside",
          color: "#fff",
          opacity: 1,
          fontSize: 11,
        },
        lineStyle: {
          color: "#424242",
          opacity: 1,
          width: 1,
          curveness: 0,
          type: "solid",
        },
        edgeSymbol: ["none", "none"],
        edgeSymbolSize: 0,
        emphasis: {
          disabled: true, // Disable all emphasis/hover effects
        },
      },
    ],
    backgroundColor: "transparent",
  };

  chart.setOption(option);
  
  // Force resize and center the chart after data update
  setTimeout(() => {
    if (chart) {
      chart.resize();
    }
  }, 100);
}

async function initChart() {
  if (!chartRef.value) return;
  chart = echarts.init(chartRef.value as HTMLDivElement);
  updateChart();
  window.addEventListener("resize", onResize);
}

function onResize() {
  if (chart) {
    chart.resize();
    // Force a small delay to ensure proper centering
    setTimeout(() => {
      if (chart) chart.resize();
    }, 50);
  }
}

onMounted(() => {
  initChart();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onResize);
  if (chart) {
    chart.dispose();
    chart = null;
  }
});

// Computed property for estimated ping value and score
const estimatedPingDisplay = computed(() => {
  const routes = activeDiagramRoutes.value;

  if (routes.length > 0) {
    const bestRoute = routes[0];
    return {
      ping: bestRoute.min_latency || 0,
      score: bestRoute.score || 0,
    };
  }
  return { ping: 0, score: 0 };
});

// Function to get color based on score
const getScoreColor = (score: number): string => {
  if (score >= 80) return "#4CAF50"; // Green for excellent
  if (score >= 60) return "#8BC34A"; // Light green for good
  if (score >= 40) return "#FFC107"; // Yellow for fair
  if (score >= 20) return "#FF9800"; // Orange for poor
  return "#F44336"; // Red for very poor
};

watch(
  [
    shouldShowDiagram,
    numberOfRoutes,
    activeDiagramRoutes,
    visualizationRoutes,
    selectedCityForVisualization,
    selectedInterfaceIndex,
    () => store.routes,
  ],
  () => {
    updateChart();
    setTimeout(() => {
      if (chart) {
        chart.resize();
      }
    }, 200);
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div
    v-if="shouldShowDiagram"
    style="position: relative; width: 100%; margin: 0; padding: 0;"
  >
    <div
      ref="chartRef"
      :style="`width: 100%; margin: 0; padding: 0; max-height: 400px; aspect-ratio: 5/2; height: ${Math.max(150, Math.max(1, activeDiagramRoutes.length) * 60 + 120)}px;`"
    ></div>
    <div
      style="position: absolute; top: 1rem; right: 1rem; background: rgba(0, 0, 0, 0.8); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 4px; text-align: center; min-width: 100px;"
    >
      <div style="color: #FFFFFF; font-size: 11px; line-height: 16px; margin-bottom: 3px; padding-top: 4px">
        Estimated Ping
      </div>
      <div
        :style="`color: ${getScoreColor(estimatedPingDisplay.score)}; font-size: 1.1rem; font-weight: bold; line-height: 16px; padding-bottom: 4px`"
      >
        {{ estimatedPingDisplay.ping }}ms
      </div>
    </div>
    <div
      v-if="showInterfaceSelector"
      class="route-diagram-interface"
      style="position: absolute; top: 1rem; left: 1rem;"
    >
      <v-select
        v-model="selectedInterfaceIndex"
        :items="interfaceSelectItems"
        :label="t('$vuetify.title.profile.interface')"
        density="compact"
        hide-details
        single-line
        variant="plain"
      />
    </div>
    <div
      class="route-diagram-selectors"
      style="position: absolute; bottom: 1rem; right: 1rem;"
    >
      <v-select
        v-model="selectedCityForVisualization"
        :items="availableCities"
        :label="t('$vuetify.title.profile.city')"
        clearable
        single-line
        variant="plain"
        density="compact"
        hide-details
      />
    </div>
  </div>
  <div v-else class="text-center pa-4 text-grey">
    Route diagram not available for this profile
  </div>
</template>

<style scoped>
.route-diagram-interface,
.route-diagram-selectors {
  min-width: 140px;
  max-width: 200px;
}
</style>
