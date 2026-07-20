export const PING_TIMEOUT_MS = 1000;
export const PING_SAMPLES_PER_SECOND = 2;
export const PING_RAW_CAP = 240;
export const PING_CHART_SLOTS = 120;

export const CHART_TIME_RANGE_SECONDS = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "60m": 3600,
} as const;

export type ChartTimeRange = keyof typeof CHART_TIME_RANGE_SECONDS;

export const PING_AGGREGATE_WINDOW_MS = CHART_TIME_RANGE_SECONDS["60m"] * 1000;
export const PING_AGGREGATE_SLOT_MS = PING_AGGREGATE_WINDOW_MS / PING_CHART_SLOTS;

export function isPingTimeout(latency: number | null | undefined, ok?: boolean) {
  if (ok === false) {
    return true;
  }
  if (latency === null || latency === undefined) {
    return true;
  }
  // 0 ms is how the backend encodes ICMP failures in the raw history.
  return latency <= 0 || latency >= PING_TIMEOUT_MS;
}
