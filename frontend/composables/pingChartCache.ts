import {
  CHART_TIME_RANGE_SECONDS,
  isPingTimeout,
  PING_AGGREGATE_SLOT_MS,
  PING_AGGREGATE_WINDOW_MS,
  PING_CHART_SLOTS,
  PING_RAW_CAP,
  PING_SAMPLES_PER_SECOND,
  PING_TIMEOUT_MS,
  type ChartTimeRange,
} from "~/constants/pingChart";

export interface PingSample {  latency: number;
  ok: boolean;
  t?: number;
}

export interface PingSlotAggregate {
  sum: number;
  count: number;
  failCount: number;
}

export interface InterfacePingChartCache {
  raw: PingSample[];
  slots: PingSlotAggregate[];
  slotEpochMs: number;
  lastIncomingLength: number;
}

export interface LatencyPingCache {
  byInterface: Record<string, InterfacePingChartCache>;
}

export interface ChartPingSlot {
  value: number | null;
  failed: boolean;
}

function emptySlot(): PingSlotAggregate {
  return { sum: 0, count: 0, failCount: 0 };
}

function failedPing(sample: PingSample) {
  return !sample.ok || isPingTimeout(sample.latency, sample.ok);
}

function normalizeSamples(
  incoming: Array<{ latency?: number; ok?: boolean; t?: number }>
): PingSample[] {
  return incoming.map((point) => {
    const latency = Number(point.latency ?? 0);
    const ok =
      point.ok !== false &&
      latency > 0 &&
      latency < PING_TIMEOUT_MS;
    return {
      latency: ok ? latency : PING_TIMEOUT_MS,
      ok,
      t: point.t,
    };
  });
}

function rotateSlots(cache: InterfacePingChartCache, now: number) {
  if (cache.slotEpochMs === 0) {
    cache.slotEpochMs = now - PING_AGGREGATE_WINDOW_MS;
  }

  const elapsed = now - cache.slotEpochMs;
  const slotsToAdvance = Math.floor(elapsed / PING_AGGREGATE_SLOT_MS);
  if (slotsToAdvance <= 0) {
    return;
  }

  const advance = Math.min(slotsToAdvance, PING_CHART_SLOTS);
  for (let i = 0; i < advance; i++) {
    cache.slots.push(emptySlot());
    if (cache.slots.length > PING_CHART_SLOTS) {
      cache.slots.shift();
    }
  }
  cache.slotEpochMs += advance * PING_AGGREGATE_SLOT_MS;
}

function addToSlot(slot: PingSlotAggregate, sample: PingSample) {
  if (failedPing(sample)) {
    slot.failCount++;
    return;
  }
  slot.sum += sample.latency;
  slot.count++;
}

function ingestSampleIntoSlots(
  cache: InterfacePingChartCache,
  sample: PingSample,
  now: number
) {
  rotateSlots(cache, now);
  const timestamp = sample.t ?? now;
  const ageMs = now - timestamp;
  if (ageMs < 0 || ageMs > PING_AGGREGATE_WINDOW_MS) {
    return;
  }

  const index =
    PING_CHART_SLOTS - 1 - Math.floor(ageMs / PING_AGGREGATE_SLOT_MS);
  if (index < 0 || index >= cache.slots.length) {
    return;
  }

  addToSlot(cache.slots[index], sample);
}

export function mergeInterfacePingCache(
  cache: InterfacePingChartCache | undefined,
  incomingPings: Array<{ latency?: number; ok?: boolean; t?: number }>,
  now = Date.now()
): InterfacePingChartCache {
  const samples = normalizeSamples(incomingPings);
  const next: InterfacePingChartCache = cache ?? {
    raw: [],
    slots: Array.from({ length: PING_CHART_SLOTS }, emptySlot),
    slotEpochMs: now - PING_AGGREGATE_WINDOW_MS,
    lastIncomingLength: 0,
  };

  let newSamples = samples;
  if (
    samples.length >= next.lastIncomingLength &&
    next.lastIncomingLength > 0
  ) {
    newSamples = samples.slice(next.lastIncomingLength);
  } else if (samples.length < next.raw.length) {
    next.raw = [];
  }
  next.lastIncomingLength = samples.length;

  for (const sample of newSamples) {
    const withTime = { ...sample, t: sample.t ?? now };
    next.raw.push(withTime);
    ingestSampleIntoSlots(next, withTime, now);
  }
  next.raw = next.raw.slice(-PING_RAW_CAP);

  return next;
}

function downsampleRawToSlots(
  raw: PingSample[],
  windowSeconds: number,
  displaySlots: number
): ChartPingSlot[] {
  const maxRaw = windowSeconds * PING_SAMPLES_PER_SECOND;
  const slice = raw.slice(-maxRaw).slice(-displaySlots);
  const slots: ChartPingSlot[] = slice.map((sample) => {
    if (failedPing(sample)) {
      return { value: null, failed: true };
    }
    return { value: sample.latency, failed: false };
  });

  const padCount = Math.max(0, displaySlots - slots.length);
  return [
    ...Array.from({ length: padCount }, () => ({ value: null, failed: false })),
    ...slots,
  ];
}

function slotsToChartSamples(
  slots: PingSlotAggregate[]
): PingSample[] {
  const now = Date.now();
  const start = now - PING_AGGREGATE_WINDOW_MS;
  const samples: PingSample[] = [];

  slots.forEach((slot, index) => {
    if (slot.count === 0 && slot.failCount === 0) {
      return;
    }

    const timestamp = start + index * PING_AGGREGATE_SLOT_MS;
    if (slot.count > 0) {
      samples.push({
        latency: slot.sum / slot.count,
        ok: true,
        t: timestamp,
      });
      return;
    }

    samples.push({
      latency: PING_TIMEOUT_MS,
      ok: false,
      t: timestamp,
    });
  });

  return samples;
}

function averageDownsample(
  samples: PingSample[],
  displaySlots: number
): ChartPingSlot[] {
  if (samples.length === 0) {
    return Array.from({ length: displaySlots }, () => ({
      value: null,
      failed: false,
    }));
  }

  if (samples.length <= displaySlots) {
    const padded: ChartPingSlot[] = Array.from(
      { length: displaySlots - samples.length },
      () => ({ value: null, failed: false })
    );
    for (const sample of samples) {
      if (failedPing(sample)) {
        padded.push({ value: null, failed: true });
      } else {
        padded.push({ value: sample.latency, failed: false });
      }
    }
    return padded;
  }

  const result: ChartPingSlot[] = [];
  const chunkSize = samples.length / displaySlots;

  for (let slot = 0; slot < displaySlots; slot++) {
    const start = Math.floor(slot * chunkSize);
    const end = Math.floor((slot + 1) * chunkSize);
    const bucket = samples.slice(start, end);
    if (bucket.length === 0) {
      result.push({ value: null, failed: false });
      continue;
    }

    const successful = bucket.filter((sample) => !failedPing(sample));
    const failed = bucket.some((sample) => failedPing(sample));
    if (successful.length === 0) {
      result.push({ value: null, failed });
      continue;
    }

    const average =
      successful.reduce((sum, sample) => sum + sample.latency, 0) /
      successful.length;
    result.push({ value: average, failed });
  }

  return result;
}

export function chartSlotsFromAggregatedPoints(
  points: Array<{ latency?: number; ok?: boolean; t?: number }>,
  windowSeconds: number,
  displaySlots: number
): ChartPingSlot[] {
  const samples = normalizeSamples(points).filter((sample) => sample.t !== undefined);
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const visible = samples.filter(
    (sample) => now - (sample.t ?? now) <= windowMs
  );
  return averageDownsample(visible, displaySlots);
}

export function samplesForChartWindow(
  cache: InterfacePingChartCache | undefined,
  windowSeconds: number,
  displaySlots: number,
  aggregatedPoints?: Array<{ latency?: number; ok?: boolean; t?: number }>
): ChartPingSlot[] {
  if (windowSeconds <= CHART_TIME_RANGE_SECONDS["1m"]) {
    return downsampleRawToSlots(cache?.raw ?? [], windowSeconds, displaySlots);
  }

  if (aggregatedPoints && aggregatedPoints.length > 0) {
    return chartSlotsFromAggregatedPoints(
      aggregatedPoints,
      windowSeconds,
      displaySlots
    );
  }

  if (!cache) {
    return Array.from({ length: displaySlots }, () => ({
      value: null,
      failed: false,
    }));
  }

  rotateSlots(cache, Date.now());
  const timeline = [
    ...slotsToChartSamples(cache.slots),
    ...cache.raw,
  ].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));

  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const visible = timeline.filter(
    (sample) => now - (sample.t ?? now) <= windowMs
  );
  return averageDownsample(visible, displaySlots);
}

export function mergeLatencyPingCache(
  cache: LatencyPingCache | undefined,
  latency: {
    interfaces?: Record<
      string,
      { pings?: Array<{ latency?: number; ok?: boolean; t?: number }> }
    >;
  },
  now = Date.now()
): LatencyPingCache {
  const next: LatencyPingCache = {
    byInterface: { ...(cache?.byInterface ?? {}) },
  };

  for (const [name, iface] of Object.entries(latency.interfaces ?? {})) {
    next.byInterface[name] = mergeInterfacePingCache(
      next.byInterface[name],
      iface.pings ?? [],
      now
    );
  }

  return next;
}

export function isLongChartWindow(windowSeconds: number) {
  return windowSeconds > CHART_TIME_RANGE_SECONDS["1m"];
}

export function chartTimeRangeToSeconds(range: ChartTimeRange) {
  return CHART_TIME_RANGE_SECONDS[range];
}
