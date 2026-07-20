import type { Latency } from "~/bindings/github.com/lagzap/zap/data";
import { computed, toValue, type MaybeRef, type Ref } from "vue";
import type { NetworkSpeedPoint } from "~/types/monitoring";
import {
  CHART_TIME_RANGE_SECONDS,
  isPingTimeout,
  PING_SAMPLES_PER_SECOND,
  PING_TIMEOUT_MS,
  type ChartTimeRange,
} from "~/constants/pingChart";
import {
  type LatencyPingCache,
  samplesForChartWindow,
  isLongChartWindow,
} from "~/composables/pingChartCache";

export type { ChartTimeRange };
export {
  CHART_TIME_RANGE_SECONDS,
  isPingTimeout,
  PING_SAMPLES_PER_SECOND,
  PING_TIMEOUT_MS,
};

export const CHART_TIME_RANGE_OPTIONS: ChartTimeRange[] = [
  "1m",
  "5m",
  "15m",
  "60m",
];

/** Probe cadence for game routes — matches backend gameProbeInterval. */
export const PING_SAMPLE_INTERVAL_MS = 1000 / PING_SAMPLES_PER_SECOND;
export const CHART_LINE_UPDATE_MS = PING_SAMPLE_INTERVAL_MS;
export const SPEED_SAMPLES_PER_SECOND = 1;

export interface MultiInterfaceLatency {
  interfaces: Record<string, Latency>;
  best_score: number;
  ping_target?: string;
  chart_slots?: Record<
    string,
    Array<{ latency?: number; ok?: boolean; t?: number }>
  >;
}

export interface TimeoutFailure {
  interfaceName: string;
  color: string;
}

export const CHART_WINDOW_SECONDS_SMALL = 30;
export const CHART_DISPLAY_SLOTS_SMALL =
  CHART_WINDOW_SECONDS_SMALL * PING_SAMPLES_PER_SECOND;
export const CHART_DISPLAY_SLOTS = 120;
export const CHART_WINDOW_SECONDS_LARGE = CHART_TIME_RANGE_SECONDS["1m"];
export const CHART_WINDOW_SIZE_SMALL = CHART_DISPLAY_SLOTS_SMALL;
export const CHART_WINDOW_SIZE_LARGE = CHART_DISPLAY_SLOTS;
export const CHART_WINDOW_SIZE = CHART_WINDOW_SIZE_LARGE;
export const SPEED_HISTORY_SECONDS = CHART_TIME_RANGE_SECONDS["60m"];
export const SPEED_HISTORY_SIZE_LARGE = SPEED_HISTORY_SECONDS;
export const SPEED_HISTORY_SIZE_SMALL = CHART_WINDOW_SECONDS_SMALL;

/** Material Design hue families — one unique family per network interface. */
export type MaterialShade = 700 | 500 | 400 | 300;

export type MaterialInterfacePalette = Record<MaterialShade, string>;

/**
 * Interface hues in display order: green → blue → yellow → pink → purple
 * (then extras if more adapters are present).
 */
export const MATERIAL_INTERFACE_PALETTES: readonly MaterialInterfacePalette[] = [
  // 1 — Green
  { 700: "#689F38", 500: "#8BC34A", 400: "#9CCC65", 300: "#AED581" },
  // 2 — Blue
  { 700: "#1976D2", 500: "#2196F3", 400: "#42A5F5", 300: "#64B5F6" },
  // 3 — Yellow (Amber — readable on dark charts)
  { 700: "#F9A825", 500: "#FFC107", 400: "#FFCA28", 300: "#FFD54F" },
  // 4 — Pink
  { 700: "#C2185B", 500: "#E91E63", 400: "#EC407A", 300: "#F06292" },
  // 5 — Purple (Deep Purple)
  { 700: "#512DA8", 500: "#673AB7", 400: "#7E57C2", 300: "#9575CD" },
  // Extras
  { 700: "#0097A7", 500: "#00BCD4", 400: "#26C6DA", 300: "#4DD0E1" }, // Cyan
  { 700: "#E64A19", 500: "#FF5722", 400: "#FF7043", 300: "#FF8A65" }, // Deep Orange
  { 700: "#455A64", 500: "#607D8B", 400: "#78909C", 300: "#90A4AE" }, // Blue Grey
] as const;

/** Connection 1 (darkest) → connection 4 (lightest). */
export const MATERIAL_CONNECTION_SHADES: readonly MaterialShade[] = [
  700, 500, 400, 300,
];

/** M3 tonal palette — legacy ping accents / timeout */
export const PING_CHART_COLORS = [
  MATERIAL_INTERFACE_PALETTES[0][500],
  MATERIAL_INTERFACE_PALETTES[1][500],
  MATERIAL_INTERFACE_PALETTES[2][500],
  MATERIAL_INTERFACE_PALETTES[3][500],
  MATERIAL_INTERFACE_PALETTES[0][400],
  MATERIAL_INTERFACE_PALETTES[1][400],
  MATERIAL_INTERFACE_PALETTES[2][400],
  "#EF5350", // Red 400 — timeouts
] as const;

export const PING_BAR_COLOR = MATERIAL_INTERFACE_PALETTES[0][500];
export const PING_TIMEOUT_COLOR = "#EF5350";

/** M3 tonal palette — speed overlays (kept distinct from latency hues) */
export const SPEED_CHART_COLORS = [
  "#42A5F5", // Blue 400
  "#64B5F6", // Blue 300
  "#90CAF9", // Blue 200
  "#5C6BC0", // Indigo 400
  "#7986CB", // Indigo 300
  "#EC407A", // Pink 400
  "#F06292", // Pink 300
  "#F48FB1", // Pink 200
] as const;

/** @deprecated Use colorForChartSeries / interfaceConnectionColor */
export const INTERFACE_CHART_COLORS = PING_CHART_COLORS;

export function chartColorAt(
  palette: readonly string[],
  index: number
): string {
  return palette[((index % palette.length) + palette.length) % palette.length];
}

export function parseSeriesInterfaceKey(seriesKey: string): {
  iface: string;
  slot: number;
} {
  const sep = seriesKey.indexOf("::");
  if (sep >= 0) {
    const slot = Number.parseInt(seriesKey.slice(sep + 2), 10);
    return {
      iface: seriesKey.slice(0, sep) || seriesKey,
      slot: Number.isFinite(slot) && slot >= 0 ? slot : 0,
    };
  }
  return { iface: seriesKey, slot: 0 };
}

/**
 * Unique adapter names in first-seen order so profile group 0 (main) is green,
 * group 1 blue, etc. ICMP overview follows series order the same way.
 */
export function uniqueInterfaceOrder(seriesKeys: string[]): string[] {
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

export function materialPaletteAt(ifaceIndex: number): MaterialInterfacePalette {
  const index =
    ((ifaceIndex % MATERIAL_INTERFACE_PALETTES.length) +
      MATERIAL_INTERFACE_PALETTES.length) %
    MATERIAL_INTERFACE_PALETTES.length;
  return MATERIAL_INTERFACE_PALETTES[index];
}

export function ifaceIndexInOrder(
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
  ifaceIndex = 0
): string {
  const palette = materialPaletteAt(ifaceIndex);
  const shadeIndex = Math.min(
    Math.max(connectionIndex, 0),
    MATERIAL_CONNECTION_SHADES.length - 1
  );
  return palette[MATERIAL_CONNECTION_SHADES[shadeIndex]];
}

/** Primary interface color (ICMP chart / connection 1). */
export function interfaceBaseColor(
  ifaceName: string,
  ifaceIndex = 0
): string {
  return interfaceConnectionColor(ifaceName, 0, ifaceIndex);
}

/**
 * Color for a chart series key. ICMP uses bare iface names; profile routes use
 * `iface::slot` so connection 1–4 get progressively lighter MD shades.
 */
export function colorForChartSeries(
  seriesKey: string,
  ifaceOrder: string[] = []
): string {
  const { iface, slot } = parseSeriesInterfaceKey(seriesKey);
  const order =
    ifaceOrder.length > 0 ? ifaceOrder : uniqueInterfaceOrder([seriesKey]);
  return interfaceConnectionColor(iface, slot, ifaceIndexInOrder(iface, order));
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

export function getJitterColorClass(jitterMs: number): string {
  if (jitterMs <= 5) {
    return "green";
  }
  if (jitterMs <= 15) {
    return "lime";
  }
  if (jitterMs <= 30) {
    return "amber";
  }
  return "red";
}

export function getLossColorClass(lossPercent: number): string {
  if (lossPercent <= 0) {
    return "green";
  }
  if (lossPercent <= 1) {
    return "lime";
  }
  if (lossPercent <= 5) {
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

function rankInterfacesByAvgLatency(
  interfaces: Record<string, Latency>
): string[] {
  return Object.keys(interfaces).sort((a, b) => {
    const avgA = effectiveAvgLatency(interfaces[a]);
    const avgB = effectiveAvgLatency(interfaces[b]);
    if (avgA !== avgB) {
      return avgA - avgB;
    }
    return a.localeCompare(b);
  });
}

function effectiveAvgLatency(iface: Latency | undefined): number {
  if (!iface) {
    return Infinity;
  }

  const okPings = (iface.pings ?? []).filter(
    (ping) => ping.ok && !isPingTimeout(ping.latency, ping.ok)
  );
  if (okPings.length === 0) {
    return Infinity;
  }

  return iface.avg_latency ?? Infinity;
}

export function getBestInterfaceName(
  interfaces: Record<string, Latency>
): string | null {
  const ranked = rankInterfacesByAvgLatency(interfaces);
  return ranked[0] ?? null;
}

interface PingSample {
  latency: number;
  ok: boolean;
  t?: number;
}

interface BucketedPingSlot {
  value: number | null;
  failed: boolean;
}

function bucketPingSamplesForInterface(
  pings: PingSample[],
  windowSeconds: number,
  displaySlots: number
): BucketedPingSlot[] {
  const maxRaw = windowSeconds * PING_SAMPLES_PER_SECOND;
  const slice = pings.slice(-maxRaw);
  const padCount = Math.max(0, maxRaw - slice.length);
  const padded: (PingSample | null)[] = [
    ...Array(padCount).fill(null),
    ...slice,
  ];

  const slotValues: BucketedPingSlot[] = [];

  for (let slot = 0; slot < displaySlots; slot++) {
    const start = Math.floor((slot * maxRaw) / displaySlots);
    const end = Math.floor(((slot + 1) * maxRaw) / displaySlots);
    const bucket = padded
      .slice(start, end)
      .filter((ping): ping is PingSample => ping !== null);

    if (bucket.length === 0) {
      slotValues.push({ value: null, failed: false });
      continue;
    }

    const successful = bucket.filter(
      (ping) => ping.ok && !isPingTimeout(ping.latency, ping.ok)
    );
    const failed = bucket.some(
      (ping) => !ping.ok || isPingTimeout(ping.latency, ping.ok)
    );

    if (successful.length === 0) {
      slotValues.push({ value: null, failed });
      continue;
    }

    slotValues.push({
      value: Math.min(...successful.map((ping) => ping.latency)),
      failed,
    });
  }

  return slotValues;
}

function rollingPingSamplesForInterface(
  pings: PingSample[],
  windowSeconds: number,
  displaySlots: number,
  samplesPerSecond = PING_SAMPLES_PER_SECOND
): BucketedPingSlot[] {
  const maxSamples = windowSeconds * samplesPerSecond;
  const slice = pings.slice(-maxSamples).slice(-displaySlots);
  const slotValues: BucketedPingSlot[] = slice.map((ping) => {
    const failed = !ping.ok || isPingTimeout(ping.latency, ping.ok);
    return {
      value: failed ? null : ping.latency,
      failed,
    };
  });

  const padCount = Math.max(0, displaySlots - slotValues.length);
  return [
    ...Array.from({ length: padCount }, () => ({ value: null, failed: false })),
    ...slotValues,
  ];
}

function collectInterfaceNames(history: NetworkSpeedPoint[]) {
  const names = new Set<string>();
  history.forEach((point) => {
    Object.keys(point.interfaces ?? {}).forEach((name) => names.add(name));
  });
  return [...names].sort();
}

function averageInterfaceSpeed(
  samples: NetworkSpeedPoint[],
  name: string,
  direction: "upload" | "download"
) {
  if (samples.length === 0) {
    return 0;
  }

  const total = samples.reduce(
    (sum, point) => sum + (point.interfaces?.[name]?.[direction] ?? 0),
    0
  );
  return total / samples.length;
}

export function alignPerInterfaceSpeedToPingWindow(
  history: NetworkSpeedPoint[],
  displaySlots: number,
  windowSeconds: number
) {
  const downloadByInterface: Record<string, (number | null)[]> = {};
  const uploadByInterface: Record<string, (number | null)[]> = {};
  const interfaceNames = collectInterfaceNames(history);

  interfaceNames.forEach((name) => {
    downloadByInterface[name] = Array(displaySlots).fill(null);
    uploadByInterface[name] = Array(displaySlots).fill(null);
  });

  if (history.length === 0 || displaySlots === 0 || windowSeconds === 0) {
    return { downloadByInterface, uploadByInterface, interfaceNames };
  }

  const visible = history.slice(-windowSeconds);
  const padCount = Math.max(0, windowSeconds - visible.length);
  const padded: (NetworkSpeedPoint | null)[] = [
    ...Array(padCount).fill(null),
    ...visible,
  ];

  for (let slot = 0; slot < displaySlots; slot++) {
    let start = Math.floor((slot * windowSeconds) / displaySlots);
    let end = Math.floor(((slot + 1) * windowSeconds) / displaySlots);

    // Speed is 1 sample/sec while ping uses 2 slots/sec — ensure each slot
    // maps to at least one second so we don't get empty alternating buckets.
    if (end <= start) {
      end = start + 1;
    }

    const bucket = padded
      .slice(start, Math.min(end, padded.length))
      .filter((point): point is NetworkSpeedPoint => point !== null);

    if (bucket.length === 0) {
      continue;
    }

    interfaceNames.forEach((name) => {
      const download = averageInterfaceSpeed(bucket, name, "download");
      const upload = averageInterfaceSpeed(bucket, name, "upload");

      if (download > 0) {
        downloadByInterface[name][slot] = download;
      }
      if (upload > 0) {
        uploadByInterface[name][slot] = upload;
      }
    });
  }

  return { downloadByInterface, uploadByInterface, interfaceNames };
}

/** One combined speed value per ping slot (500ms) for rolling line charts. */
export function rollingCombinedSpeedForWindow(
  history: NetworkSpeedPoint[],
  displaySlots: number,
  windowSeconds: number,
  interfaceNames: string[]
): number[] {
  if (displaySlots === 0 || windowSeconds === 0) {
    return [];
  }

  const speedSlice = history.slice(-windowSeconds);
  const padSeconds = Math.max(0, windowSeconds - speedSlice.length);
  const expanded: number[] = [];

  for (let i = 0; i < padSeconds; i++) {
    expanded.push(0, 0);
  }

  for (const point of speedSlice) {
    let total = 0;
    interfaceNames.forEach((name) => {
      const iface = point.interfaces?.[name];
      if (!iface) {
        return;
      }
      total += (iface.download ?? 0) + (iface.upload ?? 0);
    });
    expanded.push(total, total);
  }

  if (expanded.length > displaySlots) {
    return expanded.slice(-displaySlots);
  }

  return [
    ...Array(displaySlots - expanded.length).fill(0),
    ...expanded,
  ];
}

export function speedSampleCapacity(windowSize: number) {
  return Math.floor(windowSize / PING_SAMPLES_PER_SECOND);
}

/** @deprecated Use alignPerInterfaceSpeedToPingWindow */
export function alignSpeedToPingWindow(
  history: Array<{ upload: number; download: number }>,
  windowSize: number
) {
  const upload: (number | null)[] = Array(windowSize).fill(null);
  const download: (number | null)[] = Array(windowSize).fill(null);

  if (history.length === 0 || windowSize === 0) {
    return { upload, download };
  }

  const visibleSpeed = history.slice(-speedSampleCapacity(windowSize));
  const speedSpanSlots = visibleSpeed.length * PING_SAMPLES_PER_SECOND;
  const speedStartSlot = windowSize - speedSpanSlots;

  visibleSpeed.forEach((point, index) => {
    const slot =
      speedStartSlot +
      index * PING_SAMPLES_PER_SECOND +
      (PING_SAMPLES_PER_SECOND - 1);

    if (slot >= 0 && slot < windowSize) {
      upload[slot] = point.upload;
      download[slot] = point.download;
    }
  });

  return { upload, download };
}

export function computeBestEnvelope(
  seriesData: Record<string, (number | null)[]>,
  interfaceNames: string[],
  length: number
) {
  const bestSeries: (number | null)[] = [];
  const interfaceBands: Record<string, (number | null)[]> = {};

  interfaceNames.forEach((name) => {
    interfaceBands[name] = [];
  });

  for (let i = 0; i < length; i++) {
    const values: { name: string; value: number }[] = [];

    interfaceNames.forEach((name) => {
      const value = seriesData[name]?.[i];
      if (value !== null && value !== undefined && !isPingTimeout(value, true)) {
        values.push({ name, value });
      }
    });

    if (values.length === 0) {
      bestSeries.push(null);
      interfaceNames.forEach((name) => interfaceBands[name].push(null));
      continue;
    }

    const best = Math.min(...values.map((entry) => entry.value));
    bestSeries.push(best);

    interfaceNames.forEach((name) => {
      const value = seriesData[name]?.[i];
      if (value === null || value === undefined || value <= best) {
        interfaceBands[name].push(null);
      } else {
        interfaceBands[name].push(value - best);
      }
    });
  }

  return { bestSeries, interfaceBands };
}

export function useLatencyMetrics(
  latency: Ref<MultiInterfaceLatency | null | undefined>,
  options: {
    windowSize?: MaybeRef<number>;
    windowSeconds?: MaybeRef<number>;
    /** One probe sample per chart slot — enables left-scroll line charts. */
    rollingSamples?: MaybeRef<boolean>;
    pingCache?: MaybeRef<LatencyPingCache | undefined>;
    /** Probe cadence; route watchers emit ~1/sec, global internet ping is 2/sec. */
    probeSamplesPerSecond?: MaybeRef<number>;
  } = {}
) {
  const chartWindowSize = computed(
    () => toValue(options.windowSize) ?? CHART_WINDOW_SIZE_LARGE
  );
  const chartWindowSeconds = computed(
    () => toValue(options.windowSeconds) ?? CHART_WINDOW_SECONDS_LARGE
  );
  const rollingSamples = computed(
    () => toValue(options.rollingSamples) ?? false
  );
  const pingCache = computed(() => toValue(options.pingCache));
  const probeSamplesPerSecond = computed(
    () => toValue(options.probeSamplesPerSecond) ?? PING_SAMPLES_PER_SECOND
  );
  const interfacePings = computed(() => {
    const interfaceData: Record<string, any[]> = {};

    if (latency.value?.interfaces) {
      Object.entries(latency.value.interfaces).forEach(([interfaceName, iface]) => {
        interfaceData[interfaceName] = iface.pings || [];
      });
    }

    return interfaceData;
  });

  const allPings = computed(() => {
    const allPingsData: any[] = [];

    if (latency.value?.interfaces) {
      Object.values(latency.value.interfaces).forEach((iface) => {
        if (iface.pings) {
          allPingsData.push(...iface.pings);
        }
      });
    }

    return allPingsData;
  });

  const lastPingMs = computed(() => {
    const interfaceData = interfacePings.value;
    const interfaceNames = Object.keys(interfaceData);

    if (interfaceNames.length === 0) return null;

    let bestLatency = Infinity;

    interfaceNames.forEach((interfaceName) => {
      const pings = interfaceData[interfaceName];
      if (pings.length > 0) {
        const lastPing = pings[pings.length - 1];
        if (
          lastPing.ok &&
          !isPingTimeout(lastPing.latency, lastPing.ok)
        ) {
          bestLatency = Math.min(bestLatency, lastPing.latency);
        }
      }
    });

    return Number.isFinite(bestLatency) ? bestLatency : null;
  });

  const lastPingDisplay = computed(() => {
    return lastPingMs.value !== null ? `${lastPingMs.value}ms` : "--";
  });

  const combinedScore = computed(() => latency.value?.best_score || 0);

  const combinedMetrics = computed(() => {
    if (!latency.value?.interfaces) {
      return { min: 0, max: 0, avg: 0, jitter: 0, loss: 0 };
    }

    const interfaces = latency.value.interfaces;
    const bestName = getBestInterfaceName(interfaces);
    const bestIface = bestName ? interfaces[bestName] : null;

    if (!bestIface) {
      return { min: 0, max: 0, avg: 0, jitter: 0, loss: 0 };
    }

    return {
      min: bestIface.min_latency || 0,
      max: bestIface.max_latency || 0,
      avg: bestIface.avg_latency || 0,
      jitter: bestIface.jitter || 0,
      loss: bestIface.packet_loss || 0,
    };
  });

  const chartData = computed(() => {
    const interfaceData = interfacePings.value;
    const rankedInterfaces = latency.value?.interfaces
      ? rollingSamples.value
        ? Object.keys(latency.value.interfaces)
        : rankInterfacesByAvgLatency(latency.value.interfaces)
      : Object.keys(interfaceData).sort();

    if (rankedInterfaces.length === 0) {
      return {
        times: [],
        seriesData: {},
        interfaceColors: {} as Record<string, string>,
        speedInterfaceColors: {} as Record<string, string>,
        timeoutBars: [] as TimeoutFailure[][],
        rankedInterfaces: [] as string[],
        bestSeries: [] as (number | null)[],
        interfaceBands: {} as Record<string, (number | null)[]>,
        bestInterfaceName: null as string | null,
      };
    }

    const windowSeconds = chartWindowSeconds.value;
    const displaySlots =
      rollingSamples.value && probeSamplesPerSecond.value === 1
        ? Math.min(chartWindowSize.value, windowSeconds)
        : chartWindowSize.value;
    const times = Array.from({ length: displaySlots }, () => "");
    const seriesData: Record<string, (number | null)[]> = {};
    const timeoutBars: TimeoutFailure[][] = Array.from(
      { length: displaySlots },
      () => []
    );
    const interfaceColors: Record<string, string> = {};
    const speedInterfaceColors: Record<string, string> = {};
    const ifaceOrder = uniqueInterfaceOrder(rankedInterfaces);

    rankedInterfaces.forEach((name) => {
      interfaceColors[name] = colorForChartSeries(name, ifaceOrder);
      const { iface } = parseSeriesInterfaceKey(name);
      speedInterfaceColors[name] = interfaceBaseColor(
        iface,
        ifaceIndexInOrder(iface, ifaceOrder)
      );
      seriesData[name] = [];
    });

    rankedInterfaces.forEach((name) => {
      const pings = (interfaceData[name] ?? []).map((ping: PingSample) => ({
        latency: ping.latency,
        ok: ping.ok,
        t: ping.t,
      }));
      const aggregatedPoints = latency.value?.chart_slots?.[name];
      const useLongWindow = isLongChartWindow(windowSeconds);
      const cachedInterface = pingCache.value?.byInterface[name];
      const useCachedSamples =
        !rollingSamples.value &&
        (useLongWindow || (cachedInterface?.raw?.length ?? 0) > 0);
      const bucketed = useCachedSamples
        ? samplesForChartWindow(
            cachedInterface,
            windowSeconds,
            displaySlots,
            aggregatedPoints
          )
        : rollingSamples.value
          ? rollingPingSamplesForInterface(
              pings,
              windowSeconds,
              displaySlots,
              probeSamplesPerSecond.value
            )
          : bucketPingSamplesForInterface(pings, windowSeconds, displaySlots);

      bucketed.forEach((slot, index) => {
        if (slot.failed) {
          timeoutBars[index].push({
            interfaceName: name,
            color: interfaceColors[name],
          });
        }
        if (slot.value !== null) {
          seriesData[name].push(slot.value);
          return;
        }
        seriesData[name].push(null);
      });
    });

    const { bestSeries, interfaceBands } = computeBestEnvelope(
      seriesData,
      rankedInterfaces,
      displaySlots
    );

    return {
      times,
      seriesData,
      interfaceColors,
      speedInterfaceColors,
      timeoutBars,
      rankedInterfaces,
      bestSeries,
      interfaceBands,
      bestInterfaceName: rankedInterfaces[0] ?? null,
    };
  });

  const interfaceLegend = computed(() =>
    chartData.value.rankedInterfaces.map((name) => {
      const { iface, slot } = parseSeriesInterfaceKey(name);
      const routeLabel = latency.value?.interfaces?.[name]?.target_ip?.trim();
      // Profile series keys are `iface::slot` — prefer the route label, else "Ethernet · 2".
      // ICMP series keys are bare iface names.
      const label = name.includes("::")
        ? routeLabel || `${iface} · ${slot + 1}`
        : iface;

      return {
        name,
        label,
        targetIp: routeLabel || "",
        color: chartData.value.interfaceColors[name],
        isBest: name === chartData.value.bestInterfaceName,
      };
    })
  );

  return {
    allPings,
    lastPingMs,
    lastPingDisplay,
    combinedScore,
    combinedMetrics,
    chartData,
    interfaceLegend,
  };
}
