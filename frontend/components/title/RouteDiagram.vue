<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch } from "vue";
import { debounce } from "es-toolkit";
import { useStore } from "~/stores";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import type { DiagramRoute } from "~/bindings/github.com/lagzap/lagzap/adapter";
import { useProfileChart } from "~/composables/useProfileChart";
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
import { quietChart } from "~/utils/chartIdle";

const props = defineProps<{
  profile: Profile;
}>();

/** The "route preview" caption, for the card's notice row (null: live routes). */
const emit = defineEmits<{
  estimate: [note: { title: string; hint: string } | null];
}>();

const store = useStore();
const { t } = useLocale();
const theme = useTheme();
const { getNodeLabelByIp } = useNodeLocationLabel();

// Go builds the whole diagram (routes, per-NIC latency, estimate); this
// component only lays it out.
const { chart: profileChart } = useProfileChart(props.profile.id);
const diagram = computed(() => profileChart.value?.diagram ?? null);
const shouldShowDiagram = computed(() => !!diagram.value?.show);
const interfaceRouteGroups = computed(() => diagram.value?.interfaces ?? []);

const { selectedInterfaceKey } = useProfileViewInterface(props.profile.id);

/** Best Internet → top Routes across all NICs; named NIC → that NIC's view. */
const activeView = computed(() => {
  const d = diagram.value;
  if (!d) {
    return null;
  }
  if (selectedInterfaceKey.value === BEST_INTERFACE) {
    return d.best;
  }
  const want = selectedInterfaceKey.value.trim().toLowerCase();
  return (d.interfaces.find((item) => item.name.trim().toLowerCase() === want) ?? d.interfaces[0])?.view ?? null;
});

const activeDiagramRoutes = computed<DiagramRoute[]>(() => activeView.value?.routes ?? []);

// No route yet: Go sends the shape the settings will produce instead.
const preview = computed(() =>
  activeDiagramRoutes.value.length === 0 ? diagram.value?.preview ?? null : null
);
/** Preview or idle prediction — drawn dashed until a live route exists. */
const isEstimate = computed(() => !!preview.value || !!diagram.value?.idle);

const PREVIEW_DIRECT = "preview:direct";
const PREVIEW_DOMESTIC = "preview:domestic";

function nodeCityName(nodeId?: string | null): string {
  const node = nodeId ? store.nodes[nodeId] : undefined;
  return node ? String(store.localized(node.city) || node.name) : "";
}

function previewHop(nodeId: string, fallbackId: string) {
  const node = nodeId ? store.nodes[nodeId] : undefined;
  return { ip: node?.ipv4 ?? "", node_id: node ? nodeId : fallbackId, latency: -1 };
}

/** One placeholder path per route slot, NICs taken in turn (Best mixes them). */
const previewRoutes = computed<DiagramRoute[]>(() => {
  const p = preview.value;
  if (!p) {
    return [];
  }
  const ifaces = p.interfaces?.length ? p.interfaces : [""];
  const relay = previewHop(p.relay_node_id, "");
  const count = Math.max(1, diagram.value?.route_cap ?? 1);
  return Array.from({ length: count }, (_, i) => {
    const iface = ifaces[i % ifaces.length];
    let hops = [relay];
    if (p.direct) {
      hops = [previewHop("", PREVIEW_DIRECT)];
    } else if (p.domestic && i === 0) {
      // Domestic routes put exactly one path through an edge at home.
      hops = [previewHop(p.domestic_node_id, PREVIEW_DOMESTIC), relay];
    }
    return {
      iface,
      iface_index: i % ifaces.length,
      path_key: `preview-${i}`,
      network: "",
      hops,
      latency: 0,
      min: 0,
      avg: 0,
      max: 0,
      packet_loss: 0,
      score: 0,
    } as DiagramRoute;
  });
});

const drawnRoutes = computed<DiagramRoute[]>(() =>
  activeDiagramRoutes.value.length > 0 ? activeDiagramRoutes.value : previewRoutes.value
);
const activeDiagramEntries = computed(() =>
  drawnRoutes.value.map((route) => ({ route, iface: route.iface || "iface", ifaceIndex: route.iface_index }))
);

/** Adapter under dest — single NIC, or blank when Best mixes several. */
const selectedAdapterName = computed(() => {
  const entries = activeDiagramEntries.value;
  if (entries.length === 0) {
    return "";
  }
  const names = [
    ...new Set(
      entries.map((entry) => (entry.iface || "").trim()).filter(Boolean)
    ),
  ];
  return names.length === 1 ? names[0] : "";
});

watch(
  interfaceRouteGroups,
  (groups) => {
    if (groups.length === 0) {
      return;
    }
    if (selectedInterfaceKey.value === BEST_INTERFACE) {
      return;
    }
    const want = selectedInterfaceKey.value.trim().toLowerCase();
    const match = groups.find(
      (g) => (g.name || "").trim().toLowerCase() === want
    );
    // Keep the named NIC selection — never snap back to Best on a probe rebuild.
    // Only rewrite the key if casing/whitespace differs from the group name.
    if (match) {
      if (match.name !== selectedInterfaceKey.value) {
        selectedInterfaceKey.value = match.name;
      }
      return;
    }
  },
  { immediate: true }
);

const chartRef = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

function fingerprintDiagramRoute(route: DiagramRoute): string {
  const hopPart = (route.hops ?? []).map((hop) => `${hop.ip}:${hop.latency}`).join("|");
  return `${route.latency}:${route.score}:${Math.round(route.packet_loss)}:${route.planned ? 1 : 0}:${hopPart}`;
}

/** Stable key — avoids deep-watching the entire routes store on every probe tick. */
// The round trip the game's own traffic gets now (the actual ping line's
// newest point): ms, 0 for a timeout, null when not measured.
const actualPing = computed<number | null>(() => {
  const points = profileChart.value?.latency?.actual?.points ?? [];
  for (let i = points.length - 1; i >= Math.max(0, points.length - 6); i--) {
    if (points[i] >= 0) return points[i];
  }
  return null;
});

// The diagram's score colors for a ping: green to 90ms, red past 300ms.
function actualPingScore(ms: number): number {
  if (ms <= 90) return 90;
  if (ms <= 140) return 70;
  if (ms <= 200) return 50;
  if (ms <= 300) return 30;
  return 10;
}

// Loss and bursts the game sees, last few seconds (null: not measured).
const actualLoss = computed<number | null>(() => profileChart.value?.link?.loss ?? null);
const actualBurst = computed<number | null>(() => profileChart.value?.link?.burst ?? null);

function pctText(v: number) {
  return localDigits(`${v < 10 ? v.toFixed(1) : Math.round(v)}%`);
}

/** What the session chip and its tooltip show (time is read on hover). */
function sessionFingerprint(): string {
  const s = diagram.value?.session;
  if (!s) return "";
  return [s.network, s.ip_version, s.ping, s.score, s.connections, s.started_at, s.server, (s.internets ?? []).join(",")].join("|");
}

const diagramChartFingerprint = computed(() => {
  const entries = activeDiagramEntries.value;
  return [
    shouldShowDiagram.value,
    actualPing.value ?? -1,
    actualLoss.value === null ? -1 : pctText(actualLoss.value),
    actualBurst.value === null ? -1 : pctText(actualBurst.value),
    diagram.value?.route_cap ?? 0,
    selectedInterfaceKey.value,
    selectedAdapterName.value,
    theme.current.value.dark,
    isEstimate.value,
    preview.value?.cities ?? 0,
    sessionFingerprint(),
    entries
      .map(
        (entry, index) =>
          `${index}:${entry.iface}:${fingerprintDiagramRoute(entry.route)}`
      )
      .join(";"),
  ].join("\0");
});

// setOption repaints; a resize on every probe tick re-laid out and repainted
// the whole diagram again. Resize only when the box itself changes.
const scheduleDiagramUpdate = debounce(() => {
  updateChart();
}, 400);

const debouncedResize = debounce(() => {
  chart?.resize();
  updateChart();
}, 150);

function routeDiagramColor(routeIndex: number): string {
  const entry = activeDiagramEntries.value[routeIndex];
  const iface = entry?.iface || "iface";
  const ifaceIndex = entry?.ifaceIndex ?? 0;
  return interfaceConnectionColor(iface, routeIndex, ifaceIndex, isDarkTheme());
}

function locationForHopIp(ip?: string | null): string {
  return getNodeLabelByIp(ip);
}

function locationForRouteHop(
  hop: { ip?: string | null; node_id?: string | null } | null | undefined
): string {
  if (hop?.node_id === PREVIEW_DIRECT) {
    return "";
  }
  if (hop?.node_id === PREVIEW_DOMESTIC) {
    return t("$vuetify.title.profile.domestic");
  }
  if (preview.value && !hop?.ip) {
    return t("$vuetify.title.profile.server.automaticServer");
  }
  return locationForHopIp(hop?.ip);
}

/** Preview exit: the selection's first city, "1+N" like the server button. */
function previewDestinationName(): string {
  const p = preview.value;
  if (!p || p.direct) {
    return t("$vuetify.title.profile.server.directWithoutServer");
  }
  const city = nodeCityName(p.relay_node_id);
  if (!city) {
    return t("$vuetify.title.profile.server.automaticServer");
  }
  return p.cities > 1 ? `${city} 1+${p.cities - 1}` : city;
}

type HopTransport = "TCP" | "UDP";
type HopIpVersion = "v4" | "v6";

function resolveHopTransport(route: DiagramRoute): HopTransport {
  return route.network === "tcp" ? "TCP" : "UDP";
}

function resolveHopIpVersion(
  hop: { ip?: string | null } | null | undefined
): HopIpVersion {
  const ip = hop?.ip?.trim() || "";
  return ip.includes(":") ? "v6" : "v4";
}

function hopProtocolLabel(
  transport: HopTransport,
  hop: { ip?: string | null; node_id?: string | null } | null | undefined
): string {
  if (hop?.node_id === PREVIEW_DIRECT) {
    return t("$vuetify.networkLatency.directHop");
  }
  if (preview.value) {
    // Transport is picked per route once probes run.
    return "UDP/TCP";
  }
  return `${transport}${resolveHopIpVersion(hop)}`;
}

/** The live session at the relay: its way to the game server (UDPv4, ...)
 * and the internets its legs use (null: no live session, or a preview). */
function sessionTransport(): {
  transport: HopTransport;
  label: string;
  internets: string;
} | null {
  const session = diagram.value?.session;
  if (preview.value || !session?.network) {
    return null;
  }
  const transport: HopTransport = session.network === "tcp" ? "TCP" : "UDP";
  const version = session.ip_version === 6 ? "v6" : session.ip_version === 4 ? "v4" : "";
  const names = session.internets ?? [];
  const internets =
    names.length > 1
      ? t("$vuetify.title.profile.internets", localDigits(names.length))
      : names[0] ?? "";
  return { transport, label: `${transport}${version}`, internets };
}

/** Elapsed time as a timer: 4:07, 1:05:12. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return localDigits(h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`);
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
  protocolLabel: string,
  subLabel: string,
  chrome: ReturnType<typeof resolveDiagramChrome>
) {
  const chip = preview.value
    ? { ...resolveDiagramLabelColors(), color: chrome.hopSub }
    : transportChipStyle(transport, isDarkTheme());
  return {
    show: true,
    position: "inside" as const,
    // City above / chip on the line / NIC below. An empty bottom line keeps the
    // block balanced so the chip stays on the route line without a NIC name.
    formatter: `{a|${hopName}}\n{chip|${protocolLabel}}\n{b|${subLabel || "\u00a0"}}`,
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
        padding: [3, 6, 2, 6],
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
  protocolLabel: string,
  subLabel: string,
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
    label: hopMarkerLabel(hopName, transport, protocolLabel, subLabel, chrome),
  };
}

const FLOW_LINE_COLOR = "#424242";

/** Snap layout coords to whole pixels. */
function px(n: number) {
  return Math.round(n);
}

/** The scale ECharts' graph gives data units: it fits the nodes' box into
 * 80% of the chart's width or height, keeping its aspect. `dataHeight`
 * depends on the scale (it holds pixel room), so settle it in a few steps. */
function diagramScale(dataWidth: number, dataHeight: (scale: number) => number) {
  const w = chart?.getWidth() ?? 0;
  const h = chart?.getHeight() ?? 0;
  if (!w || !h || dataWidth <= 0) return 1;
  const byWidth = (0.8 * w) / dataWidth;
  let s = byWidth;
  for (let i = 0; i < 12; i++) {
    s = Math.max(0.2, Math.min(byWidth, (0.8 * h) / dataHeight(s)));
  }
  return s;
}

/** Column spacing that fills the width. With several routes the height
 * sets the scale, and a fixed spacing then left the diagram narrow in the
 * middle; the columns spread instead (up to 3x), the height staying as it
 * is. `extra` is the width beyond the columns (to the game icon). */
function stretchedHopSpacing(
  base: number,
  columns: number,
  extra: number,
  dataHeight: (scale: number) => number,
) {
  const w = chart?.getWidth() ?? 0;
  const h = chart?.getHeight() ?? 0;
  if (!w || !h || columns <= 0) return base;
  let s = 1;
  for (let i = 0; i < 12; i++) {
    s = Math.max(0.2, (0.8 * h) / dataHeight(s));
  }
  const fill = ((0.8 * w) / s - extra) / columns;
  return Math.max(base, Math.min(base * 3, fill));
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

/** Tonal, like the app's chips and avatars: the color mixed into the surface.
 * Solid, not see-through, so route lines never show through a label. */
function tonal(color: string, amount = 0.16) {
  const rgb = (c: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
    if (m) {
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const parts = c.match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
    return parts.length >= 3 ? parts.slice(0, 3) : null;
  };
  const surface = rgb(theme.current.value.colors.surface ?? (isDarkTheme() ? "#1E1E1E" : "#FFFFFF"));
  const tint = rgb(color);
  if (!surface || !tint) return color;
  const mix = surface.map((v, i) => Math.round(v + (tint[i] - v) * amount));
  return `rgb(${mix.join(",")})`;
}
function userAccent() {
  return theme.current.value.colors.primary ?? (isDarkTheme() ? "#E6D785" : "#8B6914");
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

/** planned: a route of the settings the live session is not using. */
function flowLineStyle(planned = false) {
  return {
    color: FLOW_LINE_COLOR,
    opacity: 1,
    width: 1,
    // Dashed = estimate (preview, idle prediction or a planned route the
    // session does not use), solid = live route.
    type: isEstimate.value || planned ? ([4, 3] as number[]) : ("solid" as const),
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
  lossPct = 0,
  transport: HopTransport = "UDP"
) {
  if (preview.value) {
    // Nothing measured yet — draw no numbers rather than fake ones.
    return;
  }
  const labelColors = resolveDiagramLabelColors();
  const loss = Math.round(lossPct);
  // Recent-window failure rate. UDP → packet loss %; TCP has no loss — Timeout / Lag.
  const timedOut = loss >= 95;
  const degraded = loss > 0;
  let text: string;
  // Loss / lag sits under the box, like the transport chip under a city.
  let subText = "";
  if (timedOut) {
    text = t("$vuetify.networkLatency.timeout");
  } else if (latencyMs < 0 || Number.isNaN(latencyMs)) {
    // Unknown / cleared per-NIC hop — not a measurement.
    text = "—";
  } else if (latencyMs === 0) {
    // Real 0: entry is the relay (no extra hop). Never paint "0ms".
    text = t("$vuetify.networkLatency.directHop");
  } else {
    text = formatMs(latencyMs);
    if (degraded) {
      subText = transport === "UDP"
        ? `${localDigits(`${loss}%`)} ${t("$vuetify.networkLatency.loss").toLowerCase()}`
        : t("$vuetify.networkLatency.lag");
    }
  }
  // The box stays neutral; only the loss line (or Timeout) is red.
  const lossColor = getScoreColor(10);
  const textColor = timedOut ? lossColor : labelColors.text;
  // Loss sits inside the box's own label (blank line above to balance), so it
  // stays right under the box at any diagram scale.
  // Same gap as the NIC name under a transport chip.
  const sub = { color: lossColor, fontSize: 9, lineHeight: 14, padding: [4, 0, 0, 0], textAlign: "center" as const };
  const balance = { ...sub, padding: [0, 0, 4, 0] };

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
      formatter: `{t|\u00a0}\n{a|${text}}\n{s|${subText || "\u00a0"}}`,
      rich: {
        t: balance,
        s: sub,
        a: {
          color: textColor,
          backgroundColor: labelColors.bg,
          borderColor: labelColors.border,
          borderWidth: 1,
          borderRadius: 1.5,
          padding: [3, 5, 2, 5],
          lineHeight: 12,
          fontSize: 11,
          fontWeight: timedOut ? "bold" : "normal",
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
  transport: HopTransport;
  planned: boolean;
};

/** Destination / exit-node tip — no “relay” wording, no server IP. */
type EndpointTooltipPayload = {
  endpointTooltip: true;
  title: string;
  country?: string;
  ping: number;
  score: number;
};

/** The relay's session chip: the game's real round trip and session info. */
type SessionTooltipPayload = {
  sessionTooltip: true;
  title?: string;
  country?: string;
  ping: number;
  score: number;
  internets: string[];
  connections: number;
  startedAt: number;
  server: string;
};

type DiagramTooltipPayload =
  | RouteTooltipPayload
  | EndpointTooltipPayload
  | SessionTooltipPayload;

function countryDisplayName(iso2?: string | null): string | undefined {
  if (!iso2) {
    return undefined;
  }
  return countryName(iso2) || undefined;
}

function buildRouteTooltipPayload(
  routeIndex: number,
  route: DiagramRoute
): RouteTooltipPayload {
  return {
    routeTooltip: true,
    routeIndex,
    routeLabel: `Route ${routeIndex + 1}`,
    estimatedPing: route.latency,
    avg: route.avg,
    min: route.min,
    max: route.max,
    score: route.score,
    loss: route.packet_loss || 0,
    transport: resolveHopTransport(route),
    planned: !!route.planned,
  };
}

function buildEndpointTooltipPayload(
  hop: { ip?: string | null; latency?: number | null } | null | undefined,
  route: DiagramRoute | null | undefined
): EndpointTooltipPayload {
  const ip = hop?.ip || undefined;
  const node = ip
    ? Object.values(store.nodes).find(
        (n) => n.ipv4 === ip || n.ipv6 === ip
      )
    : null;
  // The route's whole ping: a hop's own latency is only its last segment
  // (edge to relay), a few ms, not what the game sees.
  return {
    endpointTooltip: true,
    title: locationForHopIp(ip),
    country: countryDisplayName(node?.country),
    ping: route?.latency ?? 0,
    score: route?.score ?? 0,
  };
}

/** The live session's tooltip at the exit relay, with its city (null: no
 * live session, or a preview). */
function buildSessionTooltipPayload(
  endpoint: EndpointTooltipPayload | null
): SessionTooltipPayload | null {
  const session = diagram.value?.session;
  if (preview.value || !session?.network) {
    return null;
  }
  return {
    sessionTooltip: true,
    title: endpoint?.title,
    country: endpoint?.country,
    ping: session.ping,
    score: session.score,
    internets: session.internets ?? [],
    connections: session.connections,
    startedAt: session.started_at,
    server: session.server,
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
    diagramTooltipRow("Route", localDigits(payload.routeIndex + 1)),
    diagramTooltipRow("Ping", formatMs(payload.estimatedPing), pingColor),
    diagramTooltipRow("Avg", formatMs(payload.avg)),
    diagramTooltipRow("Min", formatMs(payload.min)),
    diagramTooltipRow("Max", formatMs(payload.max)),
  ];
  if (payload.planned) {
    rows.push(diagramTooltipRow(t("$vuetify.networkLatency.plannedRoute"), t("$vuetify.networkLatency.plannedRouteHint")));
  }
  if (payload.loss > 0) {
    if (payload.transport === "TCP") {
      rows.push(
        diagramTooltipRow(
          payload.loss >= 95
            ? t("$vuetify.networkLatency.timeout")
            : t("$vuetify.networkLatency.lag"),
          payload.loss >= 95 ? "—" : formatMs(payload.estimatedPing),
          payload.loss >= 8 ? getScoreColor(10) : undefined
        )
      );
    } else {
      rows.push(
        diagramTooltipRow(
          t("$vuetify.networkLatency.loss"),
          localDigits(`${Math.round(payload.loss)}%`),
          payload.loss >= 8 ? getScoreColor(10) : undefined
        )
      );
    }
  }
  if (payload.score > 0) {
    rows.push(diagramTooltipRow("Score", localDigits(payload.score), scoreColor));
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
      diagramTooltipRow("Ping", formatMs(payload.ping), scoreColor)
    );
  }
  if (payload.score > 0) {
    rows.push(diagramTooltipRow("Score", localDigits(payload.score), scoreColor));
  }
  return diagramTooltipTable(rows);
}

function formatSessionTooltip(payload: SessionTooltipPayload): string {
  const scoreColor = payload.score > 0 ? getScoreColor(payload.score) : undefined;
  const rows: string[] = [];
  if (payload.title) {
    rows.push(diagramTooltipRow("City", payload.title));
  }
  if (payload.country) {
    rows.push(diagramTooltipRow("Country", payload.country));
  }
  if (payload.ping > 0) {
    rows.push(diagramTooltipRow(t("$vuetify.networkLatency.sessionPing"), formatMs(payload.ping), scoreColor));
  }
  if (payload.score > 0) {
    rows.push(diagramTooltipRow(t("$vuetify.networkLatency.sessionScore"), localDigits(payload.score), scoreColor));
  }
  if (payload.internets.length > 0) {
    rows.push(diagramTooltipRow(t("$vuetify.networkLatency.sessionInternets"), payload.internets.join(", ")));
  }
  rows.push(diagramTooltipRow(t("$vuetify.networkLatency.sessionConnections"), localDigits(payload.connections)));
  if (payload.startedAt > 0) {
    rows.push(diagramTooltipRow(t("$vuetify.networkLatency.sessionTime"), formatElapsed(Date.now() - payload.startedAt)));
  }
  if (payload.server) {
    // An address: digits stay Latin, left to right.
    rows.push(diagramTooltipRow(t("$vuetify.networkLatency.gameServer"), `<span dir="ltr">${payload.server}</span>`));
  }
  return diagramTooltipTable(rows);
}

function formatDiagramTooltip(payload: DiagramTooltipPayload | undefined): string | null {
  if (!payload) {
    return null;
  }
  if ("sessionTooltip" in payload && payload.sessionTooltip) {
    return formatSessionTooltip(payload);
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

  const routes = drawnRoutes.value;
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

  // Calculate dynamic center based on layout direction
  const totalRouteHeight = (routes.length - 1) * routeSpacing;

  // Labels are drawn in pixels, but node positions scale with the chart, and
  // one route draws far larger than several. Work out the scale ECharts
  // will use and keep pixel room above the top route (city names) and below
  // the bottom route or the game's ping badge, so no label leaves the canvas.
  const badgeLinesPx = actualPing.value !== null && !isEstimate.value ? 14 : 0;
  const ROOM_ABOVE = 40;
  const ROOM_BELOW = 40;
  const BADGE_GAP = 24; // clear of the 40px game icon
  const badgeRoom = badgeLinesPx ? BADGE_GAP + badgeLinesPx + 4 : 0;
  const halfSpan = totalRouteHeight / 2;
  const roomBelow = (s: number) => Math.max(halfSpan + ROOM_BELOW / s, badgeRoom / s);
  const diagramHeight = (s: number) => halfSpan + ROOM_ABOVE / s + roomBelow(s);
  // Spacing between hops: 100, wider when the height limits the scale so
  // the diagram still fills the width.
  const hopSpacing = stretchedHopSpacing(100, maxHops + 1, 70, diagramHeight);
  const centerY = 0; // Keep center at 0, routes will be distributed around it
  const centerX = 0; // For vertical layout

  const nodes: any[] = [];
  const links: any[] = [];

  const chrome = resolveDiagramChrome();

  // Add user node (keep as circle)
  nodes.push({
    id: "user",
    name: t("$vuetify.networkLatency.you"),
    x: px(startX),
    y: px(centerY),
    symbolSize: 40,
    tooltip: { show: false },
    silent: true,
    // Tonal circle in the app's gold, like the account avatar.
    itemStyle: {
      color: tonal(userAccent(), 0.2),
      opacity: 1,
      borderWidth: 0,
    },
    label: {
      show: true,
      position: "inside",
      color: userAccent(),
      fontSize: 9,
      fontWeight: "bold",
      align: "center",
      verticalAlign: "middle",
      lineHeight: 9,
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

  const scale = diagramScale(destConvergenceX + 70 - startX, diagramHeight);

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
      const entryIface = activeDiagramEntries.value[routeIndex]?.iface || "";
      // When Best mixes NICs, put the adapter on the first hop (dest has no single NIC).
      const subLabel =
        hopIndex === 0 && !selectedAdapterName.value && entryIface
          ? entryIface
          : "";
      const protocolLabel = hopProtocolLabel(transport, hop);
      const routeColor = routeDiagramColor(routeIndex);

      nodes.push(
        hopMarkerNode(
          hopId,
          hopNodeX,
          routeY,
          hopName,
          transport,
          protocolLabel,
          subLabel,
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
          lineStyle: flowLineStyle(route.planned),
        });
        // Preserve -1 (unknown) vs 0 (direct). Do not collapse unknown → 0.
        const firstHopLatency =
          route.hops[0]?.latency != null && !Number.isNaN(route.hops[0].latency)
            ? route.hops[0].latency
            : -1;
        links.push({
          source: waypointId,
          target: hopId,
          tooltip: { show: false },
          lineStyle: flowLineStyle(route.planned),
        });
        addPingLabelNode(
          nodes,
          `ping-${routeIndex}-${hopIndex}`,
          branchX,
          routeY,
          hopNodeX,
          routeY,
          firstHopLatency,
          route.packet_loss || 0,
          transport
        );
      } else {
        const prevHopId = `route-${routeIndex}-hop-${hopIndex - 1}`;
        const prevHopNodeX = px(
          startX * 1.77777777 + hopIndex * hopSpacing + routeOffset - 24
        );
        const individualHopLatency =
          hop.latency != null && !Number.isNaN(hop.latency) ? hop.latency : -1;
        links.push({
          source: prevHopId,
          target: hopId,
          tooltip: { show: false },
          lineStyle: flowLineStyle(route.planned),
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
      // Single-hop = user dials the relay directly → label DIRECT (not 0ms).
      const finalHopLatency =
        route.hops.length === 1
          ? 0
          : finalHop?.latency != null && !Number.isNaN(finalHop.latency)
            ? finalHop.latency
            : -1;
      const routeTooltip = buildRouteTooltipPayload(routeIndex, route);
      const lastHopNodeX = px(
        startX * 1.77777777 + hops.length * hopSpacing + routeOffset - 24
      );

      // Full route hit strip between the trunks
      const hitLeft = branchX;
      const hitRight = waypointX;
      const hitWidth = Math.max(hitRight - hitLeft + 24, 96);
      const hitX = px((hitLeft + hitRight) / 2);

      if (!preview.value) nodes.push({
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
        lineStyle: flowLineStyle(route.planned),
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
        lineStyle: flowLineStyle(route.planned),
      });
    } else {
      // If no hops, connect directly from user to destination
      links.push({
        source: "user",
        target: "destination",
        lineStyle: flowLineStyle(route.planned),
      });
    }
  });

  // Spine hits: left = route metrics; right (exit node) = location tip, not route #.
  if (routes.length > 0 && !preview.value) {
    const leftSpineTooltip = buildRouteTooltipPayload(0, routes[0]);
    const bestForEndpoint = routes[activeView.value?.estimate.best ?? -1] ?? routes[0];
    const endpointHop =
      bestForEndpoint.hops?.[bestForEndpoint.hops.length - 1] ?? null;
    const endpointTooltip = buildEndpointTooltipPayload(
      endpointHop,
      bestForEndpoint
    );
    const rightSpineTooltip: DiagramTooltipPayload =
      buildSessionTooltipPayload(endpointTooltip) ?? endpointTooltip;

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
  const bestRoute = routes[activeView.value?.estimate.best ?? -1] ?? routes[0];
  const estimatedPing: number | null = bestRoute?.latency || null;
  const lastHop = bestRoute?.hops?.[bestRoute.hops.length - 1];
  if (preview.value) {
    destinationName = previewDestinationName();
  } else if (lastHop) {
    destinationName = locationForRouteHop(lastHop);
  }

  const destColor = preview.value
    ? chrome.hopSub
    : routes.length > 0 ? routeDiagramColor(0) : "#424242";

  // Final exit hop: city above, adapter name below (empty slot in the path).
  // With a live session the relay shows how it reaches the game (UDPv4, ...)
  // as a transport chip in place of the dot.
  const adapterLabel = selectedAdapterName.value || "";
  const session = sessionTransport();
  const tip = buildSessionTooltipPayload(
    lastHop ? buildEndpointTooltipPayload(lastHop, bestRoute) : null
  );
  if (session && tip) {
    nodes.push({
      ...hopMarkerNode(
        "destination",
        destConvergenceX + 30,
        centerY,
        destinationName,
        session.transport,
        session.label,
        session.internets,
        chrome,
        destColor
      ),
      // A hit area the size of the chip, so hovering it shows the session.
      symbol: "rect",
      symbolSize: [46, 20],
      silent: false,
      tooltip: { show: true },
      value: tip,
    });
  } else {
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
        // Always two lines (blank when no adapter is picked): one line sat
        // centered on the dot, closer to it than the city with an adapter.
        formatter: `{a|${destinationName}}\n{b|${adapterLabel || " "}}`,
        rich: {
          a: {
            color: chrome.hopLabel,
            fontSize: 11,
            fontWeight: "normal",
            lineHeight: 14,
            align: "center",
            padding: [0, 0, 22, 0],
          },
          b: {
            color: chrome.hopSub,
            fontSize: 9,
            fontWeight: "normal",
            lineHeight: 14,
            align: "center",
            padding: [22, 0, 0, 0],
          },
        },
      },
    });
  }

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

  // The graph scales to fit its nodes: two invisible nodes hold the room
  // worked out above, above the top route and below the bottom route or
  // the badge under the game.
  const badgeTop = centerY + BADGE_GAP / scale;
  for (const [id, y] of [
    ["room-above", centerY - halfSpan - ROOM_ABOVE / scale],
    ["room-below", centerY + roomBelow(scale)],
  ] as const) {
    nodes.push({
      id,
      name: "",
      x: px(destConvergenceX + 70),
      y,
      symbolSize: 0,
      tooltip: { show: false },
      silent: true,
      itemStyle: { color: "transparent" },
      label: { show: false },
    });
  }

  // Under the game: only the ping it actually gets. Loss and bursts show in
  // the note at the chart's bottom-right corner, so the chart never moves.
  if (actualPing.value !== null && !isEstimate.value) {
    const ms = actualPing.value;
    const timedOut = ms === 0;
    const color = getScoreColor(timedOut ? 10 : actualPingScore(ms));
    const text = timedOut ? t("$vuetify.networkLatency.timeout") : formatMs(ms);
    nodes.push({
      id: "actual-ping",
      name: text,
      x: px(destConvergenceX + 70),
      y: badgeTop,
      symbolSize: 0,
      tooltip: { show: false },
      silent: true,
      z: 20,
      label: {
        show: true,
        position: "inside",
        verticalAlign: "top",
        formatter: `{a|${text}}`,
        rich: {
          a: { color, lineHeight: 14, fontSize: 11, fontWeight: "bold", textAlign: "center" },
        },
      },
    });
  }

  const option = {
    animation: false,
    textStyle: { fontFamily: chartFontFamily() },
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
        fontFamily: chartFontFamily(),
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

// The chart div only exists once Go reports show=true, usually after mount,
// and is re-created when the diagram hides; follow the element itself.
// The box's height eases between route counts (CSS); the chart follows it
// frame by frame instead of jumping to the end size.
let boxObserver: ResizeObserver | null = null;
let resizeFrame = 0;
watch(
  chartRef,
  (el) => {
    chart?.dispose();
    boxObserver?.disconnect();
    chart = el ? quietChart(echarts.init(el, null, { useDirtyRect: true })) : null;
    if (el) {
      boxObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        // Label room depends on the chart's size: lay it out again.
        resizeFrame = requestAnimationFrame(() => {
          chart?.resize();
          updateChart();
        });
      });
      boxObserver.observe(el);
    }
    updateChart();
  },
  { flush: "post" }
);

function onResize() {
  debouncedResize();
}

onMounted(() => {
  window.addEventListener("resize", onResize);
});

onBeforeUnmount(() => {
  scheduleDiagramUpdate.cancel();
  debouncedResize.cancel();
  window.removeEventListener("resize", onResize);
  boxObserver?.disconnect();
  cancelAnimationFrame(resizeFrame);
  if (chart) {
    chart.dispose();
    chart = null;
  }
});

const estimateCaption = computed(() => {
  if (preview.value) {
    return t("$vuetify.title.profile.routePreviewHint");
  }
  return diagram.value?.idle ? t("$vuetify.title.profile.routePredictedHint") : "";
});

watch(
  () =>
    shouldShowDiagram.value && isEstimate.value
      ? { title: t("$vuetify.title.profile.routePreview"), hint: estimateCaption.value }
      : null,
  (note) => emit("estimate", note),
  { immediate: true, deep: true }
);
onBeforeUnmount(() => emit("estimate", null));

// Selector must repaint immediately — debounced probe ticks are too slow.
watch(selectedInterfaceKey, () => {
  updateChart();
});

// Loss and bursts of the game's own connection, for the corner note: shown
// only while there are any. The protocol resends every lost packet, so loss
// costs the game time, never data: the note says so.
const linkNote = computed(() => {
  if (actualPing.value === null || isEstimate.value) return null;
  const loss = actualLoss.value ?? 0;
  const burst = actualBurst.value ?? 0;
  if (loss <= 0 && burst <= 0) return null;
  return {
    loss: loss > 0 ? pctText(loss) : "",
    lossColor: getScoreColor(loss >= 5 ? 10 : 30),
    burst: burst > 0 ? pctText(burst) : "",
    burstColor: getScoreColor(burst >= 20 ? 10 : 30),
  };
});

// The chart box grows with the route count only; a preview or prediction
// has no ping under the game to make room for. The last 24px held the
// card's notice row, which now sits on the chart's bottom-left corner.
const chartHeight = computed(
  () => Math.max(1, drawnRoutes.value.length) * 50 + (isEstimate.value ? 60 : 80) + 24
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
      :style="`width: 100%; margin: 0; padding: 0; max-height: 400px; aspect-ratio: 5/2; height: ${chartHeight}px;`"
    ></div>
    <div v-if="linkNote" class="route-diagram-note">
      <div v-if="linkNote.loss" :style="{ color: linkNote.lossColor }">
        {{ t("$vuetify.networkLatency.loss") }} {{ linkNote.loss }}
      </div>
      <div v-if="linkNote.loss" class="route-diagram-note__muted">
        {{ t("$vuetify.networkLatency.lossRecovered") }}
      </div>
      <div v-if="linkNote.burst" :style="{ color: linkNote.burstColor }">
        <v-icon icon="mdi-pulse" size="12" />
        {{ t("$vuetify.networkLatency.burst") }} {{ linkNote.burst }}
      </div>
    </div>
  </div>
  <div v-else-if="diagram" class="text-center pa-4 text-grey">
    Route diagram not available for this profile
  </div>
</template>

<style scoped>
.route-diagram-root,
.route-diagram-chart {
  overflow: visible !important;
}

.route-diagram-chart {
  transition: height 0.25s ease;
}

.route-diagram-chart :deep(canvas) {
  overflow: visible;
}

/* Loss and bursts sit in the bottom-right corner, out of the chart, so the
 * chart keeps its size and layout whatever they show. */
.route-diagram-note {
  position: absolute;
  right: 4px;
  bottom: 0;
  font-size: 10px;
  line-height: 14px;
  text-align: right;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}

.route-diagram-note__muted {
  font-size: 9px;
  line-height: 12px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}







/* Under the badge, like loss under a hop box. */


</style>
