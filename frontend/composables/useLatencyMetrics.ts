import type { Latency } from "~/bindings/github.com/lagzap/zap/data";

export interface MultiInterfaceLatency {
  interfaces: Record<string, Latency>;
  best_score: number;
  ping_target?: string;
}

/** Material Design hue families — one unique family per network interface. */
type MaterialShade = 800 | 700 | 600 | 500 | 400 | 300 | 200;

type MaterialInterfacePalette = Record<MaterialShade, string>;

/**
 * Interface hues in display order: green → blue → yellow → pink → purple
 * (then extras if more adapters are present).
 */
const MATERIAL_INTERFACE_PALETTES: readonly MaterialInterfacePalette[] = [
  // 1 — Green
  { 800: "#558B2F", 700: "#689F38", 600: "#7CB342", 500: "#8BC34A", 400: "#9CCC65", 300: "#AED581", 200: "#C5E1A5" },
  // 2 — Blue
  { 800: "#1565C0", 700: "#1976D2", 600: "#1E88E5", 500: "#2196F3", 400: "#42A5F5", 300: "#64B5F6", 200: "#90CAF9" },
  // 3 — Yellow (Amber — readable on dark charts)
  { 800: "#FF8F00", 700: "#F9A825", 600: "#FFB300", 500: "#FFC107", 400: "#FFCA28", 300: "#FFD54F", 200: "#FFE082" },
  // 4 — Pink
  { 800: "#AD1457", 700: "#C2185B", 600: "#D81B60", 500: "#E91E63", 400: "#EC407A", 300: "#F06292", 200: "#F48FB1" },
  // 5 — Purple (Deep Purple)
  { 800: "#4527A0", 700: "#512DA8", 600: "#5E35B1", 500: "#673AB7", 400: "#7E57C2", 300: "#9575CD", 200: "#B39DDB" },
  // Extras
  { 800: "#00838F", 700: "#0097A7", 600: "#00ACC1", 500: "#00BCD4", 400: "#26C6DA", 300: "#4DD0E1", 200: "#80DEEA" }, // Cyan
  { 800: "#D84315", 700: "#E64A19", 600: "#F4511E", 500: "#FF5722", 400: "#FF7043", 300: "#FF8A65", 200: "#FFAB91" }, // Deep Orange
  { 800: "#37474F", 700: "#455A64", 600: "#546E7A", 500: "#607D8B", 400: "#78909C", 300: "#90A4AE", 200: "#B0BEC5" }, // Blue Grey
] as const;

/** Connection 1 → 4 shades. Dark theme uses the soft end, light the deep end. */
const MATERIAL_CONNECTION_SHADES: readonly MaterialShade[] = [
  400, 300, 500, 200,
];
const MATERIAL_CONNECTION_SHADES_LIGHT: readonly MaterialShade[] = [
  700, 800, 600, 500,
];
export const PING_TIMEOUT_COLOR = "#EF5350";

function parseSeriesInterfaceKey(seriesKey: string): {
  iface: string;
  slot: number;
  network?: string;
  pathKey?: string;
} {
  const parts = seriesKey.split("::");
  if (parts.length >= 3) {
    // Profile route: iface::tcp|udp::pathKey
    const iface = parts[0] || seriesKey;
    const network = parts[1] || "";
    const pathKey = parts.slice(2).join("::");
    let slot = 0;
    for (let i = 0; i < pathKey.length; i++) {
      slot = (slot + pathKey.charCodeAt(i)) % 4;
    }
    if (network === "tcp") {
      slot = (slot + 1) % 4;
    }
    return { iface, slot, network, pathKey };
  }
  if (parts.length === 2) {
    const slot = Number.parseInt(parts[1], 10);
    return {
      iface: parts[0] || seriesKey,
      slot: Number.isFinite(slot) && slot >= 0 ? slot : 0,
    };
  }
  return { iface: seriesKey, slot: 0 };
}

/**
 * Unique adapter names in first-seen order so profile group 0 (main) is green,
 * group 1 blue, etc. ICMP overview follows series order the same way.
 */
function uniqueInterfaceOrder(seriesKeys: string[]): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const key of seriesKeys) {
    const { iface } = parseSeriesInterfaceKey(key);
    if (!iface || seen.has(iface)) {
      continue;
    }
    seen.add(iface);
    order.push(iface);
  }
  return order;
}

function materialPaletteAt(ifaceIndex: number): MaterialInterfacePalette {
  const index =
    ((ifaceIndex % MATERIAL_INTERFACE_PALETTES.length) +
      MATERIAL_INTERFACE_PALETTES.length) %
    MATERIAL_INTERFACE_PALETTES.length;
  return MATERIAL_INTERFACE_PALETTES[index];
}

function ifaceIndexInOrder(
  ifaceName: string,
  ifaceOrder: string[]
): number {
  const index = ifaceOrder.indexOf(ifaceName);
  return index >= 0 ? index : 0;
}

/** Shade for connection index 0..n (0 = darkest / primary). */
export function interfaceConnectionColor(
  ifaceName: string,
  connectionIndex = 0,
  ifaceIndex = 0,
  dark = true
): string {
  const palette = materialPaletteAt(ifaceIndex);
  const shades = dark ? MATERIAL_CONNECTION_SHADES : MATERIAL_CONNECTION_SHADES_LIGHT;
  const shadeIndex = Math.min(Math.max(connectionIndex, 0), shades.length - 1);
  return palette[shades[shadeIndex]];
}

/**
 * Primary interface color (ICMP chart / traffic). Dark theme uses the softer
 * 400 shade (like the profile route lines); light keeps the deeper 700.
 */
export function interfaceBaseColor(
  ifaceName: string,
  ifaceIndex = 0,
  dark = false
): string {
  return materialPaletteAt(ifaceIndex)[dark ? 400 : 700];
}

/**
 * Color for a chart series key. ICMP uses bare iface names; profile routes use
 * `iface::network::pathKey` (shade from path hash) or legacy `iface::slot`.
 */
export function colorForChartSeries(
  seriesKey: string,
  ifaceOrder: string[] = [],
  dark = true
): string {
  const { iface, slot } = parseSeriesInterfaceKey(seriesKey);
  const order =
    ifaceOrder.length > 0 ? ifaceOrder : uniqueInterfaceOrder([seriesKey]);
  return interfaceConnectionColor(iface, slot, ifaceIndexInOrder(iface, order), dark);
}

export function getScoreColorClass(score: number | null): string {
  if (score === null || score < 0) {
    return "grey";
  }

  if (score >= 80) {
    return "green";
  } else if (score >= 70) {
    return "lime";
  } else if (score >= 60) {
    return "amber";
  } else {
    return "red";
  }
}

export function getLatencyColorClass(latencyMs: number): string {
  if (latencyMs <= 50) {
    return "green";
  }
  if (latencyMs <= 100) {
    return "lime";
  }
  if (latencyMs <= 150) {
    return "amber";
  }
  return "red";
}

/** Soft greens for dark UI; saturated greens for light UI. */
function metricAccent(tier: "good" | "ok", dark: boolean): string {
  if (dark) {
    return tier === "good" ? "#81C784" : "#C5E1A5";
  }
  return tier === "good" ? "#2E7D32" : "#558B2F";
}

/** Theme-aware accent for summary metrics — null means use theme default text */
export function getScoreAccent(
  score: number | null,
  dark = true
): string | null {
  if (score === null || score < 0) {
    return null;
  }
  if (score >= 80) {
    return metricAccent("good", dark);
  }
  if (score >= 70) {
    return metricAccent("ok", dark);
  }
  return null;
}

export function getJitterAccent(jitterMs: number, dark = true): string | null {
  if (jitterMs <= 5) {
    return metricAccent("good", dark);
  }
  if (jitterMs <= 15) {
    return metricAccent("ok", dark);
  }
  return null;
}

export function getLossAccent(lossPercent: number, dark = true): string | null {
  if (lossPercent <= 0) {
    return metricAccent("good", dark);
  }
  if (lossPercent <= 1) {
    return metricAccent("ok", dark);
  }
  return null;
}
