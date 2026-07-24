import type {
  NetworkHistoryEdge,
  NetworkHistoryEvent,
  NetworkHistorySample,
  NetworkHistoryUsage,
} from "~/utils/networkHistoryDB";
import {
  getNetworkHistoryEdge,
  getNetworkHistoryEvents,
  getNetworkHistorySamples,
  getNetworkHistoryUsage,
} from "~/utils/networkHistoryDB";

export type NetworkReportRange = "24h" | "7d" | "30d";

export const NETWORK_REPORT_RANGE_MS: Record<NetworkReportRange, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** Stable i18n category for skip reasons — never show raw engine codes in UI. */
export type SkipReasonCategory =
  | "latencySpikeNoPath"
  | "severeLagNoPath"
  | "noBetterPath"
  | "cooldown"
  | "pathWouldNotHelp"
  | "relayLoss"
  | "relayJitter"
  | "relayScore"
  | "other";

export type SkipReasonBucket = {
  /** Machine category for i18n + aggregates */
  key: SkipReasonCategory;
  count: number;
};

export type HourBucket = {
  hour: number;
  sampleCount: number;
  avgLatencyMs: number;
  avgLossPct: number;
};

export type LocationUsageBucket = {
  key: string;
  label: string;
  count: number;
  sharePct: number;
};

export type EdgeCityStat = {
  cityKey: string;
  city: string;
  country: string;
  region: string;
  regionLabel: string;
  avgLatencyMs: number;
  bestLatencyMs: number;
  sampleCount: number;
};

export type EdgeRegionBest = {
  region: string;
  regionLabel: string;
  city: string;
  country: string;
  avgLatencyMs: number;
  sampleCount: number;
  /** Share of user connection time in this region (0–100). */
  usageSharePct: number;
};

export type PrimaryRegionFocus = {
  key: string;
  label: string;
  sharePct: number;
};

export type NetworkReport = {
  range: NetworkReportRange;
  periodStart: number;
  periodEnd: number;
  sampleCount: number;
  eventCount: number;
  latencyP50: number | null;
  latencyP95: number | null;
  lossMean: number | null;
  protectedPct: number;
  spikeCount: number;
  hoursActive: number;
  lagFix: {
    verified: number;
    failed: number;
    skipped: number;
    pending: number;
    userSide: number;
    internetSide: number;
    totalImprovementMs: number;
  };
  relayPath: {
    silentRedial: number;
    pathAdded: number;
    pathRemoved: number;
    other: number;
  };
  topSkipReasons: SkipReasonBucket[];
  worstHours: HourBucket[];
  topCountries: LocationUsageBucket[];
  topCities: LocationUsageBucket[];
  /** @deprecated use topCities */
  topServers: LocationUsageBucket[];
  /** Regions the user actually connected through, ranked by use. */
  topRegions: LocationUsageBucket[];
  /** Primary focus region for edge latency narrative (most-used). */
  primaryRegion: PrimaryRegionFocus | null;
  edgeCities: EdgeCityStat[];
  bestByRegion: EdgeRegionBest[];
  bestEdgeOverall: EdgeCityStat | null;
  summaryKeys: string[];
};

/** Coarse payload for a future server sync — no path keys or raw samples. */
export type NetworkUploadAggregate = {
  period_start: string;
  period_end: string;
  client_version?: string;
  range: NetworkReportRange;
  sample_count: number;
  hours_active: number;
  latency_p50: number | null;
  latency_p95: number | null;
  loss_mean: number | null;
  protected_pct: number;
  spike_count: number;
  lag_fix: {
    verified: number;
    failed: number;
    skipped: number;
  };
  top_skip_reasons: SkipReasonBucket[];
  top_countries: Array<{ key: string; count: number }>;
  top_cities: Array<{ city: string; country: string; count: number }>;
  best_edge_by_region: Array<{
    region: string;
    city: string;
    country: string;
    avg_latency_ms: number;
  }>;
};

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) {
    return null;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) {
    return sorted[lo];
  }
  const w = rank - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

/**
 * Map engine skip strings like `no_candidate:latency_spike=9->108ms`
 * to a stable human category (UI never shows the raw code).
 */
export function classifySkipReason(reason?: string): SkipReasonCategory {
  if (!reason) {
    return "other";
  }
  const raw = reason.trim().toLowerCase();

  if (raw.startsWith("cooldown") || raw.includes("cooldown")) {
    return "cooldown";
  }
  if (raw.includes("apply_noop")) {
    return "pathWouldNotHelp";
  }
  if (raw.includes("latency_spike")) {
    return "latencySpikeNoPath";
  }
  if (raw.includes("severe_lag")) {
    return "severeLagNoPath";
  }
  if (
    raw.includes("relay_loss") ||
    (raw.includes("relay") && /\bloss\b/.test(raw))
  ) {
    return "relayLoss";
  }
  if (raw.includes("relay_jitter") || raw.includes("jitter")) {
    return "relayJitter";
  }
  if (raw.includes("relay_score") || raw.includes("score=")) {
    return "relayScore";
  }
  if (raw.includes("no_candidate")) {
    return "noBetterPath";
  }
  return "other";
}

/** @deprecated use classifySkipReason — kept for any callers expecting a string key */
export function normalizeSkipReason(reason?: string): string {
  return classifySkipReason(reason);
}

function buildHourBuckets(samples: NetworkHistorySample[]): HourBucket[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    sampleCount: 0,
    latencySum: 0,
    lossSum: 0,
  }));
  for (const sample of samples) {
    const hour = new Date(sample.at).getHours();
    const bucket = buckets[hour];
    bucket.sampleCount += 1;
    bucket.latencySum += sample.latency_ms;
    bucket.lossSum += sample.loss_pct;
  }
  return buckets
    .filter((b) => b.sampleCount > 0)
    .map((b) => ({
      hour: b.hour,
      sampleCount: b.sampleCount,
      avgLatencyMs: b.latencySum / b.sampleCount,
      avgLossPct: b.lossSum / b.sampleCount,
    }))
    .sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
    .slice(0, 3);
}

function aggregateUsage(
  usage: NetworkHistoryUsage[],
  kind: "country" | "server" | "city" | "region",
  limit = 5
): LocationUsageBucket[] {
  const map = new Map<string, { label: string; count: number }>();
  for (const row of usage) {
    if (row.kind !== kind) {
      continue;
    }
    const prev = map.get(row.key);
    if (prev) {
      prev.count += 1;
      if (row.label) {
        prev.label = row.label;
      }
    } else {
      map.set(row.key, { label: row.label || row.key, count: 1 });
    }
  }
  const total = [...map.values()].reduce((sum, v) => sum + v.count, 0);
  return [...map.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      count: v.count,
      sharePct: total > 0 ? (v.count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Focus edge latency on regions the user actually used.
 * Example: mostly EU connections → rank EU cities, not domestic IR edges.
 */
function aggregateEdgeLatency(
  edges: NetworkHistoryEdge[],
  usage: NetworkHistoryUsage[]
): {
  edgeCities: EdgeCityStat[];
  bestByRegion: EdgeRegionBest[];
  bestEdgeOverall: EdgeCityStat | null;
  primaryRegion: PrimaryRegionFocus | null;
  topRegions: LocationUsageBucket[];
} {
  const topRegions = aggregateUsage(usage, "region", 8);
  const primaryRegion: PrimaryRegionFocus | null = topRegions[0]
    ? {
        key: topRegions[0].key,
        label: topRegions[0].label,
        sharePct: topRegions[0].sharePct,
      }
    : null;

  // Regions that matter: primary + any other with meaningful share (≥15%).
  const focusKeys = new Set<string>();
  if (primaryRegion) {
    focusKeys.add(primaryRegion.key);
    for (const r of topRegions) {
      if (r.sharePct >= 15) {
        focusKeys.add(r.key);
      }
    }
  }

  const byCity = new Map<
    string,
    {
      city: string;
      country: string;
      region: string;
      regionLabel: string;
      sum: number;
      best: number;
      count: number;
    }
  >();

  for (const row of edges) {
    if (!(row.latency_ms > 0) || !row.city_key) {
      continue;
    }
    if (focusKeys.size > 0 && row.region && !focusKeys.has(row.region)) {
      continue;
    }
    const prev = byCity.get(row.city_key);
    if (prev) {
      prev.sum += row.latency_ms;
      prev.count += 1;
      prev.best = Math.min(prev.best, row.latency_ms);
      if (row.city) prev.city = row.city;
      if (row.country) prev.country = row.country;
      if (row.region_label) prev.regionLabel = row.region_label;
    } else {
      byCity.set(row.city_key, {
        city: row.city || row.city_key,
        country: row.country || "",
        region: row.region || "",
        regionLabel: row.region_label || row.region || "",
        sum: row.latency_ms,
        best: row.latency_ms,
        count: 1,
      });
    }
  }

  const edgeCities = [...byCity.entries()]
    .map(([cityKey, v]) => ({
      cityKey,
      city: v.city,
      country: v.country,
      region: v.region,
      regionLabel: v.regionLabel,
      avgLatencyMs: v.sum / v.count,
      bestLatencyMs: v.best,
      sampleCount: v.count,
    }))
    .sort((a, b) => {
      // Prefer primary region cities first, then by latency.
      if (primaryRegion) {
        const aPri = a.region === primaryRegion.key ? 0 : 1;
        const bPri = b.region === primaryRegion.key ? 0 : 1;
        if (aPri !== bPri) return aPri - bPri;
      }
      return a.avgLatencyMs - b.avgLatencyMs;
    });

  const usageShare = new Map(
    topRegions.map((r) => [r.key, r.sharePct] as const)
  );

  const byRegion = new Map<string, EdgeCityStat>();
  for (const city of edgeCities) {
    if (!city.region) continue;
    const prev = byRegion.get(city.region);
    if (!prev || city.avgLatencyMs < prev.avgLatencyMs) {
      byRegion.set(city.region, city);
    }
  }

  const bestByRegion = [...byRegion.values()]
    .map((city) => ({
      region: city.region,
      regionLabel: city.regionLabel,
      city: city.city,
      country: city.country,
      avgLatencyMs: city.avgLatencyMs,
      sampleCount: city.sampleCount,
      usageSharePct: usageShare.get(city.region) ?? 0,
    }))
    .sort((a, b) => {
      if (b.usageSharePct !== a.usageSharePct) {
        return b.usageSharePct - a.usageSharePct;
      }
      return a.avgLatencyMs - b.avgLatencyMs;
    });

  const primaryCities = primaryRegion
    ? edgeCities.filter((c) => c.region === primaryRegion.key)
    : edgeCities;

  return {
    edgeCities: (primaryCities.length > 0 ? primaryCities : edgeCities).slice(
      0,
      8
    ),
    bestByRegion,
    bestEdgeOverall: (primaryCities[0] ?? edgeCities[0]) ?? null,
    primaryRegion,
    topRegions,
  };
}

function pickSummaryKeys(report: Omit<NetworkReport, "summaryKeys">): string[] {
  const keys: string[] = [];
  if (report.sampleCount === 0 && report.eventCount === 0) {
    return ["empty"];
  }
  if (report.protectedPct >= 20) {
    keys.push("oftenProtected");
  }
  if ((report.latencyP95 ?? 0) >= 150) {
    keys.push("highP95");
  } else if ((report.latencyP50 ?? 0) > 0 && (report.latencyP50 ?? 0) < 50) {
    keys.push("lowMedian");
  }
  if ((report.lossMean ?? 0) >= 5) {
    keys.push("lossy");
  } else if ((report.lossMean ?? 0) < 1 && report.sampleCount > 0) {
    keys.push("stableLoss");
  }
  if (report.lagFix.verified > 0) {
    keys.push("pathSwapsHelped");
  }
  if (report.lagFix.skipped > report.lagFix.verified * 2) {
    keys.push("manySkips");
  }
  if (report.spikeCount >= 5) {
    keys.push("frequentSpikes");
  }
  if (report.bestEdgeOverall) {
    keys.push("bestEdge");
  }
  if (keys.length === 0) {
    keys.push("baseline");
  }
  return keys.slice(0, 4);
}

export function buildNetworkReportFromData(
  range: NetworkReportRange,
  periodStart: number,
  periodEnd: number,
  events: NetworkHistoryEvent[],
  samples: NetworkHistorySample[],
  usage: NetworkHistoryUsage[] = [],
  edges: NetworkHistoryEdge[] = []
): NetworkReport {
  const latencies = samples
    .map((s) => s.latency_ms)
    .filter((ms) => ms > 0)
    .sort((a, b) => a - b);
  const losses = samples.map((s) => s.loss_pct);
  const protectedCount = samples.filter((s) => s.protected).length;
  const spikeCount = samples.filter((s) => s.spike).length;

  const lagFix = {
    verified: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    userSide: 0,
    internetSide: 0,
    totalImprovementMs: 0,
  };
  const skipReasons = new Map<SkipReasonCategory, number>();
  const relayPath = {
    silentRedial: 0,
    pathAdded: 0,
    pathRemoved: 0,
    other: 0,
  };

  for (const event of events) {
    if (event.kind === "lag_fix" && event.lag_fix) {
      const status = (event.lag_fix.status || "").toLowerCase();
      if (status === "verified") {
        lagFix.verified += 1;
        lagFix.totalImprovementMs += event.lag_fix.improvement_ms ?? 0;
      } else if (status === "failed") {
        lagFix.failed += 1;
      } else if (status === "skipped") {
        lagFix.skipped += 1;
        const key = classifySkipReason(event.lag_fix.reason);
        skipReasons.set(key, (skipReasons.get(key) ?? 0) + 1);
      } else if (status === "pending") {
        lagFix.pending += 1;
      }
      if (event.lag_fix.user_side_lag) {
        lagFix.userSide += 1;
      } else {
        lagFix.internetSide += 1;
      }
    } else if (event.kind === "relay_path" && event.relay_path) {
      const kind = (event.relay_path.kind || "").toLowerCase();
      if (kind === "silent-redial") {
        relayPath.silentRedial += 1;
      } else if (kind === "path-added") {
        relayPath.pathAdded += 1;
      } else if (kind === "path-removed") {
        relayPath.pathRemoved += 1;
      } else {
        relayPath.other += 1;
      }
    }
  }

  const topSkipReasons = [...skipReasons.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const uniqueMinutes = new Set(
    samples.map((s) => Math.floor(s.at / 60_000))
  );
  const hoursActive = uniqueMinutes.size / 60;

  const topCities =
    aggregateUsage(usage, "city").length > 0
      ? aggregateUsage(usage, "city")
      : aggregateUsage(usage, "server");

  const edge = aggregateEdgeLatency(edges, usage);

  const base = {
    range,
    periodStart,
    periodEnd,
    sampleCount: samples.length,
    eventCount: events.length,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    lossMean:
      losses.length > 0
        ? losses.reduce((sum, v) => sum + v, 0) / losses.length
        : null,
    protectedPct:
      samples.length > 0 ? (protectedCount / samples.length) * 100 : 0,
    spikeCount,
    hoursActive,
    lagFix,
    relayPath,
    topSkipReasons,
    worstHours: buildHourBuckets(samples),
    topCountries: aggregateUsage(usage, "country"),
    topCities,
    topServers: topCities,
    topRegions: edge.topRegions,
    primaryRegion: edge.primaryRegion,
    edgeCities: edge.edgeCities,
    bestByRegion: edge.bestByRegion,
    bestEdgeOverall: edge.bestEdgeOverall,
  };

  return {
    ...base,
    summaryKeys: pickSummaryKeys(base),
  };
}

export async function buildNetworkReport(
  range: NetworkReportRange,
  nowMs = Date.now()
): Promise<NetworkReport> {
  const span = NETWORK_REPORT_RANGE_MS[range];
  const periodEnd = nowMs;
  const periodStart = nowMs - span;
  const [events, samples, usage, edges] = await Promise.all([
    getNetworkHistoryEvents(periodStart, periodEnd),
    getNetworkHistorySamples(periodStart, periodEnd),
    getNetworkHistoryUsage(periodStart, periodEnd),
    getNetworkHistoryEdge(periodStart, periodEnd),
  ]);
  return buildNetworkReportFromData(
    range,
    periodStart,
    periodEnd,
    events,
    samples,
    usage,
    edges
  );
}

export function buildUploadAggregate(
  report: NetworkReport,
  clientVersion?: string
): NetworkUploadAggregate {
  return {
    period_start: new Date(report.periodStart).toISOString(),
    period_end: new Date(report.periodEnd).toISOString(),
    client_version: clientVersion,
    range: report.range,
    sample_count: report.sampleCount,
    hours_active: Math.round(report.hoursActive * 10) / 10,
    latency_p50:
      report.latencyP50 != null ? Math.round(report.latencyP50) : null,
    latency_p95:
      report.latencyP95 != null ? Math.round(report.latencyP95) : null,
    loss_mean:
      report.lossMean != null ? Math.round(report.lossMean * 10) / 10 : null,
    protected_pct: Math.round(report.protectedPct * 10) / 10,
    spike_count: report.spikeCount,
    lag_fix: {
      verified: report.lagFix.verified,
      failed: report.lagFix.failed,
      skipped: report.lagFix.skipped,
    },
    top_skip_reasons: report.topSkipReasons,
    top_countries: report.topCountries.map((c) => ({
      key: c.key,
      count: c.count,
    })),
    top_cities: report.topCities.map((c) => ({
      city: c.label,
      country: c.key.length === 2 ? c.key : "",
      count: c.count,
    })),
    best_edge_by_region: report.bestByRegion.slice(0, 8).map((r) => ({
      region: r.regionLabel || r.region,
      city: r.city,
      country: r.country,
      avg_latency_ms: Math.round(r.avgLatencyMs),
    })),
  };
}
