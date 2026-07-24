<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch } from "vue";
import { debounce } from "es-toolkit";
import { Call } from "@wailsio/runtime";
import { useStore } from "~/stores";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import { NodeRoute } from "~/bindings/github.com/lagzap/zap/data";
import type { NodeRoute as NodeRouteType } from "~/bindings/github.com/lagzap/zap/data";
import {
  useProfileDisplayRoutes,
  routeRelayLatency,
  routeRelayMetrics,
  routeHopFloorMs,
  isPlausibleProbeForRoute,
  bestRouteRelayLatency,
  pickBestInterfaceGroup,
} from "~/composables/useProfileDisplayRoutes";
import {
  BEST_INTERFACE,
  useProfileViewInterface,
} from "~/composables/useProfileViewInterface";
import {
  interfaceConnectionColor,
} from "~/composables/useLatencyMetrics";
import { useNodeLocationLabel } from "~/composables/useNodeLocationLabel";
import { useLocale, useTheme } from "vuetify";
import * as echarts from "echarts";
import country from "country-list-js";

const props = defineProps<{
  profile: Profile;
}>();

const store = useStore();
const { t } = useLocale();
const theme = useTheme();
const { getNodeLabelByIp } = useNodeLocationLabel();

const {
  shouldShowRoutes: shouldShowDiagram,
  numberOfRoutes,
  interfaceRouteGroups,
  primaryRelayNodeId,
} = useProfileDisplayRoutes(computed(() => props.profile));

const { selectedInterfaceKey } = useProfileViewInterface(props.profile.id);
const probingEstimatedPing = ref(false);
const probedBestOverride = ref<{ ping: number; score: number; loss: number } | null>(null);

function bestInterfaceGroup() {
  return pickBestInterfaceGroup(interfaceRouteGroups.value);
}

const resolvedInterfaceGroup = computed(() => {
  const groups = interfaceRouteGroups.value;
  if (groups.length === 0) {
    return null;
  }
  if (selectedInterfaceKey.value === BEST_INTERFACE) {
    return bestInterfaceGroup();
  }
  return (
    groups.find((item) => item.name === selectedInterfaceKey.value) ??
    groups[0]
  );
});

/** Adapter shown under hops — for Best Internet, the winning NIC's name. */
const selectedAdapterName = computed(
  () => resolvedInterfaceGroup.value?.name ?? ""
);

const activeDiagramRoutes = computed(
  () => resolvedInterfaceGroup.value?.routes ?? []
);

watch(
  interfaceRouteGroups,
  (groups) => {
    if (groups.length === 0) {
      selectedInterfaceKey.value = BEST_INTERFACE;
      return;
    }
    if (
      selectedInterfaceKey.value !== BEST_INTERFACE &&
      !groups.some((g) => g.name === selectedInterfaceKey.value)
    ) {
      selectedInterfaceKey.value = BEST_INTERFACE;
    }
  },
  { immediate: true }
);

const chartRef = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

function fingerprintDiagramRoute(route: NodeRouteType): string {
  const hops = route.hops ?? [];
  const hopPart = hops
    .map(
      (hop) =>
        `${hop.ip ?? ""}:${Math.round(hop.latency ?? 0)}:${hop.status ?? ""}`
    )
    .join("|");
  return `${Math.round(route.avg_latency ?? 0)}:${route.score ?? 0}:${Math.round(route.packet_loss ?? 0)}:${hopPart}`;
}

/** Stable key — avoids deep-watching the entire routes store on every probe tick. */
const diagramChartFingerprint = computed(() => {
  const routes = activeDiagramRoutes.value;
  return [
    shouldShowDiagram.value,
    numberOfRoutes.value,
    selectedInterfaceKey.value,
    selectedAdapterName.value,
    theme.current.value.dark,
    routes.map((route, index) => `${index}:${fingerprintDiagramRoute(route)}`).join(";"),
  ].join("\0");
});

const scheduleDiagramUpdate = debounce(() => {
  updateChart();
  chart?.resize();
}, 400);

const debouncedResize = debounce(() => {
  chart?.resize();
}, 150);

function routeDiagramColor(routeIndex: number): string {
  const group = resolvedInterfaceGroup.value ?? interfaceRouteGroups.value[0];
  const iface = group?.name || "iface";
  const ifaceIndex = group?.index ?? 0;
  return interfaceConnectionColor(iface, routeIndex, ifaceIndex);
}

function locationForHopIp(ip?: string | null): string {
  return getNodeLabelByIp(ip);
}

function locationForRouteHop(hop: { ip?: string | null } | null | undefined): string {
  return locationForHopIp(hop?.ip);
}

type HopTransport = "TCP" | "UDP";

/** Route-level transport for hop chips — respect exclusive tcp/udp tags. */
function resolveHopTransport(route: NodeRoute): HopTransport {
  if (route.tcp_available && !route.udp_available) {
    return "TCP";
  }
  if (route.udp_available && !route.tcp_available) {
    return "UDP";
  }
  // Both (or neither) advertised as capability — prefer UDP for multipath games.
  // Route Settings stamps exclusive flags; this is only a fallback.
  if (route.udp_available) {
    return "UDP";
  }
  if (route.tcp_available) {
    return "TCP";
  }
  return "UDP";
}

/** Intermediate hops: address family. Last hop uses adapter name instead. */
function hopIpVersionLabel(hop: { ip?: string | null } | null | undefined): string {
  const ip = hop?.ip?.trim() || "";
  if (!ip) return "";
  if (ip.includes(":")) return "IPv6";
  return "IPv4";
}

function transportChipStyle(transport: HopTransport, dark: boolean) {
  const labelColors = resolveDiagramLabelColors();
  if (transport === "TCP") {
    return {
      bg: labelColors.bg,
      border: labelColors.border,
      color: dark ? "#90CAF9" : "#1565C0",
    };
  }
  return {
    bg: labelColors.bg,
    border: labelColors.border,
    color: dark ? "#E6D785" : "#8B6914",
  };
}

function hopMarkerLabel(
  hopName: string,
  transport: HopTransport,
  ipLabel: string,
  chrome: ReturnType<typeof resolveDiagramChrome>
) {
  const chip = transportChipStyle(transport, isDarkTheme());
  return {
    show: true,
    position: "inside" as const,
    // City above / chip on the line / IPv4|IPv6 below — balanced so chip centers on the hop
    formatter: `{a|${hopName}}\n{chip|${transport}}\n{b|${ipLabel}}`,
    rich: {
      a: {
        color: chrome.hopLabel,
        fontSize: 11,
        fontWeight: "normal" as const,
        lineHeight: 14,
        padding: [0, 0, 4, 0],
      },
      chip: {
        backgroundColor: chip.bg,
        color: chip.color,
        borderColor: chip.border,
        borderWidth: 1,
        borderRadius: 1.5,
        padding: [3, 5, 2, 5],
        fontSize: 10,
        fontWeight: "normal" as const,
        lineHeight: 12,
        align: "center" as const,
      },
      b: {
        color: chrome.hopSub,
        fontSize: 9,
        fontWeight: "normal" as const,
        lineHeight: 14,
        padding: [4, 0, 0, 0],
      },
    },
  };
}

function hopMarkerNode(
  id: string,
  x: number,
  y: number,
  hopName: string,
  transport: HopTransport,
  ipLabel: string,
  chrome: ReturnType<typeof resolveDiagramChrome>,
  _routeColor: string
) {
  return {
    id,
    name: hopName,
    x: px(x),
    y: px(y),
    offset: [0, 0],
    // Transport chip is the on-line marker — no circle behind it
    symbol: "circle",
    symbolSize: 0,
    tooltip: { show: false },
    silent: true,
    itemStyle: {
      color: "transparent",
      borderWidth: 0,
    },
    label: hopMarkerLabel(hopName, transport, ipLabel, chrome),
  };
}

const FLOW_LINE_COLOR = "#424242";

/** Snap layout coords to whole pixels. */
function px(n: number) {
  return Math.round(n);
}

function elbowNode(id: string, x: number, y: number) {
  return {
    id,
    name: "",
    x: px(x),
    y: px(y),
    symbolSize: 0,
    tooltip: { show: false },
    silent: true,
    itemStyle: { color: "transparent" },
    label: { show: false },
  };
}

function isDarkTheme() {
  return theme.current.value.dark;
}

function resolveDiagramChrome() {
  if (isDarkTheme()) {
    return {
      userFill: "#2D2D2D",
      userBorder: "transparent",
      userBorderWidth: 0,
      userLabel: "#FFFFFF",
      hopLabel: "#FFFFFF",
      hopSub: "#888888",
      seriesLabel: "#FFFFFF",
      tooltipBg: "rgba(18, 18, 18, 0.92)",
      tooltipBorder: "rgba(255, 255, 255, 0.08)",
      tooltipText: "#FFFFFF",
      tooltipShadow: "0 8px 24px rgba(0,0,0,0.35)",
    };
  }
  return {
    userFill: "#FFFFFF",
    userBorder: "#171717",
    userBorderWidth: 1.5,
    userLabel: "#171717",
    hopLabel: "#171717",
    hopSub: "#5C5C5C",
    seriesLabel: "#171717",
    tooltipBg: "rgba(255, 255, 255, 0.96)",
    tooltipBorder: "rgba(0, 0, 0, 0.14)",
    tooltipText: "#171717",
    tooltipShadow: "0 8px 24px rgba(0,0,0,0.12)",
  };
}

function resolveDiagramLabelColors() {
  const colors = theme.current.value.colors;
  const isDark = isDarkTheme();

  if (chartRef.value && typeof getComputedStyle !== "undefined") {
    const style = getComputedStyle(chartRef.value);
    const surface = style.getPropertyValue("--v-theme-surface").trim();
    const onSurface = style.getPropertyValue("--v-theme-on-surface").trim();
    if (surface && onSurface) {
      return {
        text: `rgb(${onSurface})`,
        bg: `rgb(${surface})`,
        border: FLOW_LINE_COLOR,
      };
    }
  }

  return {
    text: colors["on-surface"] ?? (isDark ? "#FFFFFF" : "#171717"),
    bg: colors.surface ?? (isDark ? "#1E1E1E" : "#FFFFFF"),
    border: FLOW_LINE_COLOR,
  };
}

function flowLineStyle() {
  return {
    color: FLOW_LINE_COLOR,
    opacity: 1,
    width: 1,
    type: "solid" as const,
    // Round/square caps stick ~1px past elbows so H/V look misaligned
    cap: "butt" as const,
    join: "miter" as const,
  };
}

function addPingLabelNode(
  nodes: any[],
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  latencyMs: number,
  lossPct = 0
) {
  const labelColors = resolveDiagramLabelColors();
  const loss = Math.round(lossPct);
  const text =
    loss > 0 ? `${latencyMs}ms · ${loss}% loss` : `${latencyMs}ms`;
  const textColor =
    loss >= 8
      ? getScoreColor(10)
      : loss > 0
        ? getScoreColor(35)
        : labelColors.text;

  nodes.push({
    id,
    name: text,
    x: px((x1 + x2) / 2),
    y: px((y1 + y2) / 2),
    symbolSize: 0,
    tooltip: { show: false },
    silent: true,
    z: 20,
    label: {
      show: true,
      position: "inside",
      formatter: `{a|${text}}`,
      rich: {
        a: {
          color: textColor,
          backgroundColor: labelColors.bg,
          borderColor: loss >= 8 ? textColor : labelColors.border,
          borderWidth: 1,
          borderRadius: 1.5,
          padding: [3, 5, 2, 5],
          lineHeight: 12,
          fontSize: 11,
          fontWeight: "normal",
          textAlign: "center",
          verticalAlign: "middle",
        },
      },
    },
  });
}

type RouteTooltipPayload = {
  routeTooltip: true;
  routeIndex: number;
  routeLabel: string;
  estimatedPing: number;
  avg: number;
  min: number;
  max: number;
  score: number;
  loss: number;
};

/** Destination / exit-node tip — no “relay” wording, no server IP. */
type EndpointTooltipPayload = {
  endpointTooltip: true;
  title: string;
  country?: string;
  ping: number;
  score: number;
};

type DiagramTooltipPayload = RouteTooltipPayload | EndpointTooltipPayload;

function countryDisplayName(iso2?: string | null): string | undefined {
  if (!iso2) {
    return undefined;
  }
  const name = country.findByIso2(iso2)?.name;
  return name || undefined;
}

function buildRouteTooltipPayload(
  routeIndex: number,
  route: NodeRoute
): RouteTooltipPayload {
  const metrics = routeRelayMetrics(route);
  return {
    routeTooltip: true,
    routeIndex,
    routeLabel: `Route ${routeIndex + 1}`,
    estimatedPing: metrics.estimated,
    avg: metrics.avg,
    min: metrics.min,
    max: metrics.max,
    score: metrics.score,
    loss: route.packet_loss || 0,
  };
}

function buildEndpointTooltipPayload(
  hop: { ip?: string | null; latency?: number | null } | null | undefined,
  route: NodeRoute | null | undefined
): EndpointTooltipPayload {
  const ip = hop?.ip || undefined;
  const node = ip
    ? Object.values(store.nodes).find(
        (n) => n.ipv4 === ip || n.ipv6 === ip
      )
    : null;
  const metrics = routeRelayMetrics(route);
  const hopLatency = hop?.latency || 0;
  return {
    endpointTooltip: true,
    title: locationForHopIp(ip),
    country: countryDisplayName(node?.country),
    ping: hopLatency > 0 ? hopLatency : metrics.estimated,
    score: metrics.score,
  };
}

function diagramTooltipMutedLabelColor() {
  return isDarkTheme() ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
}

function diagramTooltipRow(
  label: string,
  value: string,
  valueColor?: string
): string {
  const color = valueColor || "inherit";
  return `<tr>
    <td style="padding:3px 14px 3px 0;color:${diagramTooltipMutedLabelColor()};font-size:11px;font-weight:400;white-space:nowrap;vertical-align:baseline">${label}</td>
    <td style="padding:3px 0;text-align:right;font-size:12px;font-weight:400;color:${color};white-space:nowrap;vertical-align:baseline">${value}</td>
  </tr>`;
}

function diagramTooltipTable(rows: string[]): string {
  return `<table style="border-collapse:collapse;line-height:1.35;min-width:140px">${rows.join("")}</table>`;
}

function formatRouteTooltip(payload: RouteTooltipPayload): string {
  const scoreColor =
    payload.score > 0 ? getScoreColor(payload.score) : undefined;
  const pingColor =
    payload.score > 0 ? getScoreColor(payload.score) : undefined;
  const rows = [
    diagramTooltipRow("Route", String(payload.routeIndex + 1)),
    diagramTooltipRow("Ping", `${payload.estimatedPing}ms`, pingColor),
    diagramTooltipRow("Avg", `${payload.avg}ms`),
    diagramTooltipRow("Min", `${payload.min}ms`),
    diagramTooltipRow("Max", `${payload.max}ms`),
  ];
  if (payload.loss > 0) {
    rows.push(
      diagramTooltipRow(
        "Loss",
        `${Math.round(payload.loss)}%`,
        payload.loss >= 8 ? getScoreColor(10) : undefined
      )
    );
  }
  if (payload.score > 0) {
    rows.push(diagramTooltipRow("Score", String(payload.score), scoreColor));
  }
  return diagramTooltipTable(rows);
}

function formatEndpointTooltip(payload: EndpointTooltipPayload): string {
  const scoreColor =
    payload.score > 0 ? getScoreColor(payload.score) : undefined;
  const rows = [diagramTooltipRow("City", payload.title)];
  if (payload.country) {
    rows.push(diagramTooltipRow("Country", payload.country));
  }
  if (payload.ping > 0) {
    rows.push(
      diagramTooltipRow("Ping", `${payload.ping}ms`, scoreColor)
    );
  }
  if (payload.score > 0) {
    rows.push(diagramTooltipRow("Score", String(payload.score), scoreColor));
  }
  return diagramTooltipTable(rows);
}

function formatDiagramTooltip(payload: DiagramTooltipPayload | undefined): string | null {
  if (!payload) {
    return null;
  }
  if ("routeTooltip" in payload && payload.routeTooltip) {
    return formatRouteTooltip(payload);
  }
  if ("endpointTooltip" in payload && payload.endpointTooltip) {
    return formatEndpointTooltip(payload);
  }
  return null;
}

/** Score colors used by tooltips + estimated-ping badge (hoisted via function). */
function getScoreColor(score: number): string {
  const light = !isDarkTheme();
  if (score >= 80) return light ? "#1B7A2E" : "#4CAF50";
  if (score >= 60) return light ? "#558B2F" : "#8BC34A";
  if (score >= 40) return light ? "#F9A825" : "#FFC107";
  if (score >= 20) return light ? "#EF6C00" : "#FF9800";
  return light ? "#C62828" : "#F44336";
}

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

  const chrome = resolveDiagramChrome();

  // Add user node (keep as circle)
  nodes.push({
    id: "user",
    name: "User",
    x: px(startX),
    y: px(centerY),
    symbolSize: 40,
    tooltip: { show: false },
    silent: true,
    itemStyle: {
      color: chrome.userFill,
      opacity: 1,
      borderColor: chrome.userBorder,
      borderWidth: chrome.userBorderWidth,
    },
    label: {
      show: true,
      position: "inside",
      color: chrome.userLabel,
      fontSize: 11,
    },
  });

  // Add main branch point from user - moved further right to spread out branches
  const branchPointId = "branch-point";
  const branchX = px(startX + hopSpacing / 3);
  nodes.push(elbowNode(branchPointId, branchX, centerY));

  // Connect user to branch point
  links.push({
    source: "user",
    target: branchPointId,
    tooltip: { show: false },
    lineStyle: flowLineStyle(),
  });

  // Destination convergence X (shared by all routes)
  const destConvergenceX = px(startX + (maxHops + 1) * hopSpacing);

  // Add route nodes and links with equal spacing
  routes.forEach((route, routeIndex) => {
    const routeY = px(centerY - totalRouteHeight / 2 + routeIndex * routeSpacing);
    const hops = route.hops.length == 1 ? route.hops : route.hops.slice(0, -1);

    // Add hop nodes for this route with equal spacing
    // For routes with fewer hops, position them further right to use space better
    const routeOffset = ((maxHops - hops.length) * hopSpacing) / 2;
    hops.forEach((hop, hopIndex) => {
      const hopX = px(
        startX * 1.77777777 + (hopIndex + 1) * hopSpacing + routeOffset
      );
      const hopId = `route-${routeIndex}-hop-${hopIndex}`;
      const hopName = locationForRouteHop(hop);
      const hopNodeX = px(hopX - 24);
      const transport = resolveHopTransport(route);
      const ipLabel = hopIpVersionLabel(hop);
      const routeColor = routeDiagramColor(routeIndex);

      nodes.push(
        hopMarkerNode(
          hopId,
          hopNodeX,
          routeY,
          hopName,
          transport,
          ipLabel,
          chrome,
          routeColor
        )
      );

      // Add link from previous node with angular path using waypoints
      if (hopIndex === 0) {
        // Create waypoint for angular path from branch point to first hop
        const waypointId = `waypoint-${routeIndex}-${hopIndex}`;

        // Point elbow — no rect cap (those attach edges to box sides → 1px stubs)
        nodes.push(elbowNode(waypointId, branchX, routeY));

        // Connect branch point -> waypoint (vertical line to route level)
        links.push({
          source: "branch-point",
          target: waypointId,
          tooltip: { show: false },
          lineStyle: flowLineStyle(),
        });
        const firstHopLatency = route.hops[0]?.latency || 0;
        links.push({
          source: waypointId,
          target: hopId,
          tooltip: { show: false },
          lineStyle: flowLineStyle(),
        });
        addPingLabelNode(
          nodes,
          `ping-${routeIndex}-${hopIndex}`,
          branchX,
          routeY,
          hopNodeX,
          routeY,
          firstHopLatency,
          route.packet_loss || 0
        );
      } else {
        const prevHopId = `route-${routeIndex}-hop-${hopIndex - 1}`;
        const prevHopNodeX = px(
          startX * 1.77777777 + hopIndex * hopSpacing + routeOffset - 24
        );
        const individualHopLatency = hop.latency || 0;
        links.push({
          source: prevHopId,
          target: hopId,
          tooltip: { show: false },
          lineStyle: flowLineStyle(),
        });
        addPingLabelNode(
          nodes,
          `ping-${routeIndex}-${hopIndex}`,
          prevHopNodeX,
          routeY,
          hopNodeX,
          routeY,
          individualHopLatency
        );
      }
    });

    if (hops.length > 0) {
      const lastHopId = `route-${routeIndex}-hop-${hops.length - 1}`;
      const waypointId = `waypoint-dest-${routeIndex}`;
      const waypointX = destConvergenceX;

      nodes.push(elbowNode(waypointId, waypointX, routeY));

      const finalHop = route.hops[route.hops.length - 1];
      const finalHopLatency =
        route.hops.length === 1 ? 0 : finalHop?.latency || 0;
      const routeTooltip = buildRouteTooltipPayload(routeIndex, route);
      const lastHopNodeX = px(
        startX * 1.77777777 + hops.length * hopSpacing + routeOffset - 24
      );

      // Full route hit strip between the trunks
      const hitLeft = branchX;
      const hitRight = waypointX;
      const hitWidth = Math.max(hitRight - hitLeft + 24, 96);
      const hitX = px((hitLeft + hitRight) / 2);

      nodes.push({
        id: `route-${routeIndex}-hit`,
        name: "",
        x: hitX,
        y: routeY,
        symbol: "rect",
        symbolSize: [hitWidth, 36],
        tooltip: { show: true },
        silent: false,
        z: 200,
        itemStyle: {
          color: "transparent",
          opacity: 0,
          borderWidth: 0,
        },
        emphasis: {
          scale: false,
          itemStyle: {
            color: "transparent",
            opacity: 0,
          },
        },
        value: routeTooltip,
        label: { show: false },
      });

      links.push({
        source: lastHopId,
        target: waypointId,
        tooltip: { show: false },
        lineStyle: flowLineStyle(),
      });
      addPingLabelNode(
        nodes,
        `ping-${routeIndex}-final`,
        lastHopNodeX,
        routeY,
        waypointX,
        routeY,
        finalHopLatency
      );
      links.push({
        source: waypointId,
        target: "dest-convergence",
        tooltip: { show: false },
        lineStyle: flowLineStyle(),
      });
    } else {
      // If no hops, connect directly from user to destination
      links.push({
        source: "user",
        target: "destination",
        lineStyle: flowLineStyle(),
      });
    }
  });

  // Spine hits: left = route metrics; right (exit node) = location tip, not route #.
  if (routes.length > 0) {
    const leftSpineTooltip = buildRouteTooltipPayload(0, routes[0]);
    const bestForEndpoint =
      bestRouteRelayLatency(routes).route ?? routes[0];
    const endpointHop =
      bestForEndpoint.hops?.[bestForEndpoint.hops.length - 1] ?? null;
    const rightSpineTooltip = buildEndpointTooltipPayload(
      endpointHop,
      bestForEndpoint
    );

    const spineHit = (
      id: string,
      x1: number,
      x2: number,
      y: number,
      height: number,
      tooltipValue: DiagramTooltipPayload
    ) => {
      const width = Math.max(Math.abs(x2 - x1) + 16, 48);
      nodes.push({
        id,
        name: "",
        x: px((x1 + x2) / 2),
        y: px(y),
        symbol: "rect",
        symbolSize: [width, height],
        tooltip: { show: true },
        silent: false,
        z: 200,
        itemStyle: {
          color: "transparent",
          opacity: 0,
          borderWidth: 0,
        },
        emphasis: {
          scale: false,
          itemStyle: { color: "transparent", opacity: 0 },
        },
        value: tooltipValue,
        label: { show: false },
      });
    };

    const spineHeight = Math.max(totalRouteHeight + 48, 56);
    spineHit("spine-hit-left", startX, branchX, centerY, spineHeight, leftSpineTooltip);
    spineHit(
      "spine-hit-right",
      destConvergenceX,
      destConvergenceX + 70,
      centerY,
      spineHeight,
      rightSpineTooltip
    );
  }

  // Add destination convergence point (like branch point on user side)
  const destConvergenceId = "dest-convergence";
  nodes.push(elbowNode(destConvergenceId, destConvergenceX, centerY));

  let destinationName = "Dest";
  let estimatedPing: number | null = null;
  const bestForDest = bestRouteRelayLatency(routes);

  if (bestForDest.route) {
    estimatedPing = bestForDest.ping || null;
    const lastHop = bestForDest.route.hops?.[bestForDest.route.hops.length - 1];
    if (lastHop) {
      destinationName = locationForRouteHop(lastHop);
    }
  } else if (routes.length > 0) {
    const bestRoute = routes[0];
    estimatedPing = routeRelayLatency(bestRoute) || null;
    const lastHop = bestRoute.hops?.[bestRoute.hops.length - 1];
    if (lastHop) {
      destinationName = locationForRouteHop(lastHop);
    }
  }

  const destColor =
    routes.length > 0 ? routeDiagramColor(0) : "#424242";

  // Final exit hop: city above, adapter name below (empty slot in the path)
  const adapterLabel = selectedAdapterName.value || "";
  nodes.push({
    id: "destination",
    name: destinationName,
    x: px(destConvergenceX + 30),
    y: px(centerY),
    symbol: "circle",
    symbolSize: 10,
    tooltip: { show: false },
    silent: true,
    itemStyle: {
      color: destColor,
      borderColor: destColor,
      borderWidth: 0,
    },
    label: {
      show: true,
      position: "inside",
      distance: 0,
      formatter: adapterLabel
        ? `{a|${destinationName}}\n{b|${adapterLabel}}`
        : `{a|${destinationName}}`,
      rich: {
        a: {
          color: chrome.hopLabel,
          fontSize: 11,
          fontWeight: "normal",
          lineHeight: 14,
          align: "center",
          padding: [0, 0, 14, 0],
        },
        b: {
          color: chrome.hopSub,
          fontSize: 9,
          fontWeight: "normal",
          lineHeight: 14,
          align: "center",
          padding: [14, 0, 0, 0],
        },
      },
    },
  });

  links.push({
    source: destConvergenceId,
    target: "destination",
    tooltip: { show: false },
    lineStyle: flowLineStyle(),
  });

  nodes.push({
    id: "game-server",
    name: "Game",
    x: px(destConvergenceX + 70),
    y: px(centerY),
    symbolSize: 0,
    tooltip: { show: false },
    silent: true,
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

  links.push({
    source: "destination",
    target: "game-server",
    tooltip: { show: false },
    lineStyle: flowLineStyle(),
  });

  const option = {
    animation: false,
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
      triggerOn: "mousemove",
      renderMode: "html",
      // Flip above/below (and clamp horizontally) like axis tooltips —
      // always-above + pointer-events caused sticky/covered hover.
      position: (
        point: number[],
        _params: unknown,
        _dom: unknown,
        _rect: unknown,
        size: { contentSize: number[]; viewSize: number[] }
      ) => {
        const [contentW, contentH] = size.contentSize;
        const [viewW, viewH] = size.viewSize;
        const gap = 12;
        const margin = 8;

        let y = point[1] - contentH - gap;
        if (y < margin) {
          y = point[1] + gap;
        }
        if (y + contentH > viewH - margin) {
          y = Math.max(margin, Math.min(y, viewH - contentH - margin));
        }

        let x = point[0] - contentW / 2;
        if (x < margin) {
          x = margin;
        } else if (x + contentW > viewW - margin) {
          x = Math.max(margin, viewW - contentW - margin);
        }

        return [x, y];
      },
      enterable: false,
      hideDelay: 0,
      showDelay: 0,
      transitionDuration: 0,
      confine: false,
      alwaysShowContent: false,
      formatter: (params: any) => {
        return formatDiagramTooltip(
          params.data?.value as DiagramTooltipPayload | undefined
        );
      },
      backgroundColor: chrome.tooltipBg,
      borderColor: chrome.tooltipBorder,
      borderWidth: 1,
      textStyle: {
        color: chrome.tooltipText,
        fontSize: 12,
        fontWeight: "normal",
      },
      padding: [8, 10],
      extraCssText:
        `border-radius:8px;box-shadow:${chrome.tooltipShadow};pointer-events:none;`,
    },
    series: [
      {
        type: "graph",
        layout: "none",
        data: nodes,
        links: links,
        roam: false,
        tooltip: {
          show: true,
        },
        label: {
          show: true,
          position: "inside",
          color: chrome.seriesLabel,
          opacity: 1,
          fontSize: 11,
        },
        lineStyle: {
          color: FLOW_LINE_COLOR,
          opacity: 1,
          width: 1,
          curveness: 0,
          type: "solid",
          cap: "butt",
          join: "miter",
        },
        edgeSymbol: ["none", "none"],
        edgeSymbolSize: 0,
        emphasis: {
          focus: "none",
          scale: false,
          itemStyle: {
            opacity: 1,
          },
          lineStyle: {
            opacity: 1,
            width: 1,
            cap: "butt",
            join: "miter",
          },
        },
      },
    ],
    backgroundColor: "transparent",
  };

  chart.setOption(option, {
    lazyUpdate: true,
    replaceMerge: ["series"],
  });
}

async function initChart() {
  if (!chartRef.value) return;
  chart = echarts.init(chartRef.value as HTMLDivElement, null, {
    useDirtyRect: true,
  });
  updateChart();
  window.addEventListener("resize", onResize);
}

function onResize() {
  debouncedResize();
}

onMounted(() => {
  initChart();
});

onBeforeUnmount(() => {
  scheduleDiagramUpdate.cancel();
  debouncedResize.cancel();
  window.removeEventListener("resize", onResize);
  if (chart) {
    chart.dispose();
    chart = null;
  }
});

// Latency for the currently shown interface group (Best → winning NIC).
const estimatedPingDisplay = computed(() => {
  const routes = activeDiagramRoutes.value;
  const best = bestRouteRelayLatency(routes);
  const floor = Math.max(
    routeHopFloorMs(best.route),
    ...routes.map((route) => routeHopFloorMs(route))
  );
  const loss = best.loss || best.route?.packet_loss || 0;

  let ping = best.ping;
  const override = probedBestOverride.value;
  if (
    override &&
    override.ping > 0 &&
    isPlausibleProbeForRoute(override.ping, best.route, floor)
  ) {
    ping = override.ping;
  }

  // Never show an Estimated Ping that undercuts the hop labels (~98ms).
  if (floor >= 40 && ping > 0 && ping < floor * 0.5) {
    ping = Math.round(floor);
  } else if (floor >= 40 && ping > 0) {
    ping = Math.max(ping, Math.round(floor * 0.85));
  }

  return {
    ping,
    score: override?.score || best.score,
    loss: override?.loss ?? loss,
  };
});

function normalizeProbedRoutes(raw: unknown): NodeRouteType[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => {
      try {
        return NodeRoute.createFrom(item) as NodeRouteType;
      } catch {
        return null;
      }
    })
    .filter((route): route is NodeRouteType => route != null);
}

async function probeEstimatedPingNow() {
  if (probingEstimatedPing.value) {
    return;
  }
  const routes = activeDiagramRoutes.value;
  if (!routes.length) {
    return;
  }

  probingEstimatedPing.value = true;
  try {
    const iface = resolvedInterfaceGroup.value?.name ?? "";
    const raw = await Call.ByName(
      "main.Service.ProbeNodeRoutes",
      routes,
      iface
    );
    const probed = normalizeProbedRoutes(raw);
    const best = bestRouteRelayLatency(probed);
    const floor = Math.max(
      ...activeDiagramRoutes.value.map((route) => routeHopFloorMs(route)),
      routeHopFloorMs(best.route)
    );
    if (best.ping > 0 && isPlausibleProbeForRoute(best.ping, best.route, floor)) {
      probedBestOverride.value = {
        ping: best.ping,
        score: best.score,
        loss: best.loss || 0,
      };
    } else if (best.loss > 0 || (best.route?.packet_loss ?? 0) > 0) {
      // Keep hop-floor ping; still surface loss from the probe round.
      probedBestOverride.value = {
        ping: best.ping > 0 ? Math.max(best.ping, Math.round(floor * 0.85 || best.ping)) : Math.round(floor),
        score: best.score,
        loss: best.loss || best.route?.packet_loss || 0,
      };
    }

    const relayId = primaryRelayNodeId.value;
    if (relayId) {
      await Call.ByName("main.Service.ForceProbeRelay", relayId).catch(() => undefined);
    }
  } catch (error) {
    console.warn("Estimated ping probe failed:", error);
  } finally {
    probingEstimatedPing.value = false;
  }
}

watch(
  [activeDiagramRoutes, selectedInterfaceKey],
  () => {
    probedBestOverride.value = null;
  }
);

watch(
  diagramChartFingerprint,
  () => {
    scheduleDiagramUpdate();
  },
  { immediate: true }
);
</script>

<template>
  <div
    v-if="shouldShowDiagram"
    class="route-diagram-root"
    style="position: relative; width: 100%; margin: 0; padding: 0; overflow: visible;"
  >
    <div
      ref="chartRef"
      class="route-diagram-chart"
      :style="`width: 100%; margin: 0; padding: 0; max-height: 400px; aspect-ratio: 5/2; height: ${Math.max(150, Math.max(1, activeDiagramRoutes.length) * 60 + 120)}px;`"
    ></div>
    <button
      type="button"
      class="estimated-ping-badge"
      :class="{ 'estimated-ping-badge--dark': theme.current.value.dark }"
      :disabled="probingEstimatedPing || activeDiagramRoutes.length === 0"
      :title="t('$vuetify.title.profile.probeEstimatedPingHint')"
      @click="probeEstimatedPingNow"
    >
      <div class="estimated-ping-badge__label">
        {{ probingEstimatedPing ? t('$vuetify.title.profile.probingPing') : t('$vuetify.title.profile.estimatedPing') }}
      </div>
      <div
        class="estimated-ping-badge__value"
        :style="{ color: getScoreColor(estimatedPingDisplay.score) }"
      >
        {{ estimatedPingDisplay.ping || '—' }}{{ estimatedPingDisplay.ping ? 'ms' : '' }}
      </div>
      <div
        v-if="(estimatedPingDisplay.loss ?? 0) > 0"
        class="estimated-ping-badge__loss"
        :style="{ color: getScoreColor(Math.max(5, 100 - (estimatedPingDisplay.loss ?? 0))) }"
      >
        {{ Math.round(estimatedPingDisplay.loss ?? 0) }}% {{ t('$vuetify.networkLatency.loss') }}
      </div>
    </button>
  </div>
  <div v-else class="text-center pa-4 text-grey">
    Route diagram not available for this profile
  </div>
</template>

<style scoped>
.route-diagram-root,
.route-diagram-chart {
  overflow: visible !important;
}

.route-diagram-chart :deep(canvas) {
  overflow: visible;
}

.estimated-ping-badge {
  position: absolute;
  top: 1rem;
  right: 1rem;
  min-width: 100px;
  margin: 0;
  padding: 0;
  border-radius: 4px;
  text-align: center;
  cursor: pointer;
  color: inherit;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.18);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}

.estimated-ping-badge:disabled {
  cursor: default;
  opacity: 0.7;
}

.estimated-ping-badge__label {
  color: rgb(var(--v-theme-on-surface));
  font-size: 11px;
  line-height: 16px;
  margin-bottom: 3px;
  padding-top: 4px;
}

.estimated-ping-badge__value {
  font-size: 1.1rem;
  font-weight: bold;
  line-height: 16px;
  padding-bottom: 2px;
}

.estimated-ping-badge__loss {
  font-size: 11px;
  font-weight: 600;
  line-height: 14px;
  padding-bottom: 4px;
}

.estimated-ping-badge--dark {
  background: rgba(0, 0, 0, 0.8);
  border-color: rgba(255, 255, 255, 0.2);
  box-shadow: none;
}

.estimated-ping-badge--dark .estimated-ping-badge__label {
  color: #ffffff;
}
</style>
