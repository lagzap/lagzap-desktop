import type { Latency } from "~/bindings/github.com/lagzap/zap/data";
import { computed, toValue, type MaybeRef, type Ref } from "vue";
import type { NetworkSpeedPoint } from "~/types/monitoring";

export interface MultiInterfaceLatency {
  interfaces: Record<string, Latency>;
  best_score: number;
}

export interface TimeoutFailure {
  interfaceName: string;
  color: string;
}

export const PING_TIMEOUT_MS = 1000;
export const PING_SAMPLES_PER_SECOND = 2;
/** Probe cadence for game routes — matches backend gameProbeInterval. */
export const PING_SAMPLE_INTERVAL_MS = 1000 / PING_SAMPLES_PER_SECOND;
export const CHART_LINE_UPDATE_MS = PING_SAMPLE_INTERVAL_MS;
export const SPEED_SAMPLES_PER_SECOND = 1;

export type ChartTimeRange = "1m" | "5m" | "15m" | "60m";

export const CHART_TIME_RANGE_SECONDS: Record<ChartTimeRange, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "60m": 3600,
};

export const CHART_TIME_RANGE_OPTIONS: ChartTimeRange[] = [
  "1m",
  "5m",
  "15m",
  "60m",
];

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

/** M3 tonal palette — ping / latency (green · lime · yellow · red) */
export const PING_CHART_COLORS = [
  "#66BB6A", // Green 400
  "#81C784", // Green 300
  "#9CCC65", // Light Green 400
  "#C5E1A5", // Light Green 200
  "#FFCA28", // Amber 400
  "#FFD54F", // Amber 300
  "#DCE775", // Lime 300
  "#EF5350", // Red 400
] as const;

export const PING_BAR_COLOR = PING_CHART_COLORS[0];
export const PING_TIMEOUT_COLOR = PING_CHART_COLORS[7];

/** M3 tonal palette — speed (blue · indigo · pink · red accent) */
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

/** @deprecated Use PING_CHART_COLORS */
export const INTERFACE_CHART_COLORS = PING_CHART_COLORS;

export function chartColorAt(
  palette: readonly string[],
  index: number
): string {
  return palette[((index % palette.length) + palette.length) % palette.length];
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

/** Light M3 accent for summary metrics — null means use theme default text */
export function getScoreAccent(score: number | null): string | null {
  if (score === null || score < 0) {
    return null;
  }
  if (score >= 80) {
    return "#81C784";
  }
  if (score >= 70) {
    return "#C5E1A5";
  }
  return null;
}

export function getJitterAccent(jitterMs: number): string | null {
  if (jitterMs <= 5) {
    return "#81C784";
  }
  if (jitterMs <= 15) {
    return "#C5E1A5";
  }
  return null;
}

export function getLossAccent(lossPercent: number): string | null {
  if (lossPercent <= 0) {
    return "#81C784";
  }
  if (lossPercent <= 1) {
    return "#C5E1A5";
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

export function isPingTimeout(latency: number | null | undefined, ok?: boolean) {
  if (ok === false) {
    return true;
  }
  return latency === null || latency === undefined || latency >= PING_TIMEOUT_MS;
}

interface PingSample {
  latency: number;
  ok: boolean;
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
  displaySlots: number
): BucketedPingSlot[] {
  const maxRaw = windowSeconds * PING_SAMPLES_PER_SECOND;
  const slice = pings.slice(-maxRaw).slice(-displaySlots);
  const padCount = Math.max(0, displaySlots - slice.length);
  const slotValues: BucketedPingSlot[] = Array.from({ length: padCount }, () => ({
    value: null,
    failed: false,
  }));

  for (const ping of slice) {
    const failed = !ping.ok || isPingTimeout(ping.latency, ping.ok);
    slotValues.push({
      value: failed ? null : ping.latency,
      failed,
    });
  }

  return slotValues;
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
      ? rankInterfacesByAvgLatency(latency.value.interfaces)
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

    const displaySlots = chartWindowSize.value;
    const windowSeconds = chartWindowSeconds.value;
    const times = Array.from({ length: displaySlots }, () => "");
    const seriesData: Record<string, (number | null)[]> = {};
    const timeoutBars: TimeoutFailure[][] = Array.from(
      { length: displaySlots },
      () => []
    );
    const interfaceColors: Record<string, string> = {};
    const speedInterfaceColors: Record<string, string> = {};

    rankedInterfaces.forEach((name, index) => {
      interfaceColors[name] = chartColorAt(PING_CHART_COLORS, index);
      speedInterfaceColors[name] = chartColorAt(SPEED_CHART_COLORS, index);
      seriesData[name] = [];
    });

    rankedInterfaces.forEach((name) => {
      const pings = (interfaceData[name] ?? []).map((ping: PingSample) => ({
        latency: ping.latency,
        ok: ping.ok,
      }));
      const bucketed = rollingSamples.value
        ? rollingPingSamplesForInterface(pings, windowSeconds, displaySlots)
        : bucketPingSamplesForInterface(pings, windowSeconds, displaySlots);

      bucketed.forEach((slot, index) => {
        if (slot.value !== null) {
          seriesData[name].push(slot.value);
          return;
        }

        seriesData[name].push(null);
        if (slot.failed) {
          timeoutBars[index].push({
            interfaceName: name,
            color: interfaceColors[name],
          });
        }
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
    chartData.value.rankedInterfaces.map((name) => ({
      name,
      color: chartData.value.interfaceColors[name],
      isBest: name === chartData.value.bestInterfaceName,
    }))
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
