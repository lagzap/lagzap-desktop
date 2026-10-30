import type { OverviewLatencyStats } from "~/bindings/github.com/lagzap/lagzap/adapter";

export type LiveLatencySeries = {
  id: string;
  label: string;
  points: number[];
  /** Profile routes: the adapter, "tcp"/"udp" and the path ("a->b->relay"). */
  iface?: string;
  network?: string;
  pathKey?: string;
  /** A connection's route line: the path it was on over time (oldest
   * first; path_key "" = pulled), so past pings show their own path. */
  paths?: { at: number; path_key: string; network: string }[];
};

export type LiveLatencyChart = {
  step: number;
  end: number;
  y_max: number;
  stats: OverviewLatencyStats;
  series: LiveLatencySeries[];
  /** Trailing points whose pings may still be answered (Go). */
  pending?: number;
};
