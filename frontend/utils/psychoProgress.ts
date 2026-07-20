/**
 * Psychological optimize progress — always creeping, never stalled.
 * Real updates set a floor (ease-out). Between updates the bar keeps
 * inching toward 99; only real completion hits 100.
 */

/** Ease-out quad floor from real: 50 → ~75, 90 → ~99. */
export function easeOutProgress(realPct: number): number {
  const t = Math.min(1, Math.max(0, realPct / 100));
  return (1 - (1 - t) * (1 - t)) * 100;
}

/** Fast open: 0 → 30 over ~1.5s. */
export function bootstrapFloor(
  elapsedMs: number,
  durationMs = 1500,
  target = 30
): number {
  const u = Math.min(1, Math.max(0, elapsedMs / durationMs));
  const eased = 1 - Math.pow(1 - u, 3);
  return target * eased;
}

/**
 * Continuous creep rate (% / second). Fast early, crawl near the end.
 * Never zero while below 99 so the UI always feels alive.
 */
export function creepRatePerSec(displayPct: number): number {
  const t = Math.min(1, Math.max(0, displayPct / 99));
  return 12 * Math.pow(1 - t, 1.7) + 0.12;
}

/** Floor from real progress + bootstrap (no creep). */
export function progressFloor(realPct: number, elapsedMs: number): number {
  if (realPct >= 100) return 100;
  return Math.min(
    99,
    Math.max(easeOutProgress(realPct), bootstrapFloor(elapsedMs))
  );
}

/** @deprecated Use progressFloor — kept for stale HMR/typecheck. */
export const psychoDisplayProgress = progressFloor;
