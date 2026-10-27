import type { OverviewLatencyStats } from "~/bindings/github.com/lagzap/lagzap/adapter";

export type LiveLatencySeries = { id: string; label: string; points: number[] };

export type LiveLatencyChart = {
  step: number;
  end: number;
  y_max: number;
  stats: OverviewLatencyStats;
  series: LiveLatencySeries[];
  /** Trailing points whose pings may still be answered (Go). */
  pending?: number;
};
