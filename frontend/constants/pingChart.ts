export const PING_TIMEOUT_MS = 1000;
export const PING_RAW_CAP = 120;

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
