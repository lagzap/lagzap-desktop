import {
  computeRouteProtectionInsight,
  effectiveWindowPacketLoss,
  getBestInterfaceName,
  SUMMARY_LOSS_WINDOW_SECONDS,
  PING_SAMPLES_PER_SECOND,
} from "~/composables/useLatencyMetrics";
import { nodeCityGroupKey } from "~/composables/useNodeLocationLabel";
import { useMonitoringStore } from "~/stores/monitoring";
import { useStore } from "~/stores";
import { NodeFlag } from "~/bindings/github.com/lagzap/zap/data";
import type { Node } from "~/bindings/github.com/lagzap/zap/data";
import {
  newHistoryId,
  putNetworkHistoryEdgeBatch,
  putNetworkHistorySample,
  putNetworkHistoryUsageBatch,
  type NetworkHistoryEdge,
  type NetworkHistorySample,
  type NetworkHistoryUsage,
} from "~/utils/networkHistoryDB";
import { isNetworkHistoryConsentGranted } from "~/utils/networkHistoryConsent";

const SAMPLE_INTERVAL_MS = 30_000;
const SPIKE_CHECK_INTERVAL_MS = 5_000;
/** Capture user→edge city latencies less often than session samples. */
const EDGE_INTERVAL_MS = 120_000;
/** Absolute jump (ms) that counts as a spike sample between checks. */
const SPIKE_ABS_MS = 40;
/** Relative jump (new/old) that counts as a spike when old > 0. */
const SPIKE_RATIO = 2.5;

const ROUTE_VARIANTS = [
  "ipv4-udp",
  "ipv4-tcp",
  "ipv6-udp",
  "ipv6-tcp",
] as const;

let recorderStarted = false;
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let spikeTimer: ReturnType<typeof setInterval> | null = null;
let lastLatencyMs: number | null = null;
let lastSampleAt = 0;
let lastEdgeAt = 0;

function isEdgeOrRelay(node: Node): boolean {
  const flags = node.flags ?? 0;
  return (
    (flags & NodeFlag.NodeFlag_NODE_FLAG_RELAY) !== 0 ||
    (flags & NodeFlag.NodeFlag_NODE_FLAG_EDGE) !== 0
  );
}

function readLiveMetrics() {
  const store = useStore();
  const monitoring = useMonitoringStore();
  const interfaces = store.latency?.interfaces ?? null;
  if (!interfaces || Object.keys(interfaces).length === 0) {
    return null;
  }

  const bestName = getBestInterfaceName(interfaces);
  const best = bestName ? interfaces[bestName] : null;
  const latencyMs =
    best && best.avg_latency > 0
      ? best.avg_latency
      : best?.min_latency && best.min_latency > 0
        ? best.min_latency
        : 0;

  const lossPct = effectiveWindowPacketLoss(
    interfaces,
    SUMMARY_LOSS_WINDOW_SECONDS,
    PING_SAMPLES_PER_SECOND
  );

  const insight = computeRouteProtectionInsight(interfaces, {
    lagFixes: monitoring.lagFixHistory.value ?? [],
    windowSeconds: SUMMARY_LOSS_WINDOW_SECONDS,
    samplesPerSecond: PING_SAMPLES_PER_SECOND,
  });

  const routeCount = monitoring.routes.value?.total_routes ?? 0;
  const ifaceCount = Object.keys(interfaces).length;

  return {
    latencyMs,
    lossPct,
    protected: !!insight?.active,
    ifaceCount,
    routeCount,
  };
}

function cityLabelForNode(node: Node): string {
  const store = useStore();
  try {
    const city = store.localized(node.city);
    if (typeof city === "string" && city.trim()) {
      return city.trim();
    }
  } catch {
    /* ignore */
  }
  const en = node.city && typeof node.city === "object" ? (node.city as any).en : "";
  if (en) return String(en);
  return "Unknown city";
}

function regionLabel(regionTag: string): string {
  const store = useStore();
  const region = store.regions?.[regionTag];
  if (!region) {
    return regionTag || "Unknown region";
  }
  try {
    const name = store.localized(region.name);
    if (typeof name === "string" && name.trim()) {
      return name.trim();
    }
  } catch {
    /* ignore */
  }
  return regionTag;
}

function bestLatencyForNode(nodeId: string): number | null {
  const store = useStore();
  const monitoring = useMonitoringStore();
  let best: number | null = null;

  for (const variant of ROUTE_VARIANTS) {
    const routeTag = `${nodeId}-${variant}`;
    const probes = monitoring.routeProbeHistory.value?.[routeTag];
    if (probes?.length) {
      const latest = probes[probes.length - 1];
      for (const slot of latest.slots ?? []) {
        if (slot.latency > 0 && (best == null || slot.latency < best)) {
          best = slot.latency;
        }
      }
    }

    const routeData = store.routes?.[routeTag];
    for (const route of routeData?.routes ?? []) {
      const latency = route?.min_latency || route?.avg_latency || 0;
      if (latency > 0 && (best == null || latency < best)) {
        best = latency;
      }
    }
  }

  return best;
}

function collectUsageRows(at: number): NetworkHistoryUsage[] {
  const store = useStore();
  const monitoring = useMonitoringStore();
  const connections = monitoring.connections.value ?? [];
  const rows: NetworkHistoryUsage[] = [];
  const seenCountry = new Set<string>();
  const seenCity = new Set<string>();
  const seenRegion = new Set<string>();

  for (const conn of connections) {
    if (!conn.profile_id) {
      continue;
    }
    const country = (conn.country_code || "").toUpperCase();
    if (country && country.length === 2 && !seenCountry.has(country)) {
      seenCountry.add(country);
      rows.push({
        id: newHistoryId("country"),
        at,
        kind: "country",
        key: country,
        label: country,
      });
    }

    const nodeId = conn.node_id || conn.relay_route?.tag || "";
    const node = nodeId ? store.nodes?.[nodeId] : null;
    if (node) {
      const cityKey = nodeCityGroupKey(node);
      if (!seenCity.has(cityKey)) {
        seenCity.add(cityKey);
        rows.push({
          id: newHistoryId("city"),
          at,
          kind: "city",
          key: cityKey,
          label: cityLabelForNode(node),
        });
      }
      const region = node.region || "";
      if (region && !seenRegion.has(region)) {
        seenRegion.add(region);
        rows.push({
          id: newHistoryId("region"),
          at,
          kind: "region",
          key: region,
          label: regionLabel(region),
        });
      }
    }
  }

  return rows;
}

function activeConnectionRegionTags(): Set<string> {
  const store = useStore();
  const monitoring = useMonitoringStore();
  const tags = new Set<string>();
  for (const conn of monitoring.connections.value ?? []) {
    if (!conn.profile_id) continue;
    const nodeId = conn.node_id || conn.relay_route?.tag || "";
    const node = nodeId ? store.nodes?.[nodeId] : null;
    if (node?.region) {
      tags.add(node.region);
    }
  }
  return tags;
}

function collectEdgeRows(at: number): NetworkHistoryEdge[] {
  const store = useStore();
  const usedRegions = activeConnectionRegionTags();
  const byCity = new Map<
    string,
    {
      city: string;
      country: string;
      region: string;
      region_label: string;
      latency: number;
    }
  >();

  for (const node of Object.values(store.nodes ?? {})) {
    if (!node || !isEdgeOrRelay(node)) {
      continue;
    }
    // Prefer edges in regions the user is actually connected to.
    // If nothing connected yet, keep a full snapshot so history can start.
    if (usedRegions.size > 0 && node.region && !usedRegions.has(node.region)) {
      continue;
    }
    const latency = bestLatencyForNode(node.id);
    if (latency == null || latency <= 0) {
      continue;
    }
    const cityKey = nodeCityGroupKey(node);
    const country = (node.country || "").toUpperCase();
    const region = node.region || "";
    const prev = byCity.get(cityKey);
    if (!prev || latency < prev.latency) {
      byCity.set(cityKey, {
        city: cityLabelForNode(node),
        country,
        region,
        region_label: regionLabel(region),
        latency,
      });
    }
  }

  const rows: NetworkHistoryEdge[] = [];
  for (const [city_key, row] of byCity) {
    rows.push({
      id: newHistoryId("edge"),
      at,
      city_key,
      city: row.city,
      country: row.country,
      region: row.region,
      region_label: row.region_label,
      latency_ms: Math.round(row.latency),
    });
  }
  return rows;
}

async function writeSample(opts: {
  spike?: boolean;
  force?: boolean;
}): Promise<void> {
  const store = useStore();
  if (!store.ndisRunning) {
    return;
  }
  if (
    !store.abilities.includes("admin") ||
    !isNetworkHistoryConsentGranted()
  ) {
    return;
  }
  const metrics = readLiveMetrics();
  if (!metrics || metrics.latencyMs <= 0) {
    return;
  }

  const now = Date.now();
  if (
    !opts.force &&
    !opts.spike &&
    now - lastSampleAt < SAMPLE_INTERVAL_MS - 500
  ) {
    return;
  }

  const sample: NetworkHistorySample = {
    id: newHistoryId(opts.spike ? "spike" : "sample"),
    at: now,
    latency_ms: Math.round(metrics.latencyMs),
    loss_pct: Math.round(metrics.lossPct * 10) / 10,
    protected: metrics.protected,
    iface_count: metrics.ifaceCount,
    route_count: metrics.routeCount,
    spike: opts.spike || undefined,
  };

  lastSampleAt = now;
  lastLatencyMs = metrics.latencyMs;
  await putNetworkHistorySample(sample);

  if (!opts.spike) {
    const usage = collectUsageRows(now);
    if (usage.length > 0) {
      await putNetworkHistoryUsageBatch(usage);
    }
    if (now - lastEdgeAt >= EDGE_INTERVAL_MS) {
      const edges = collectEdgeRows(now);
      if (edges.length > 0) {
        await putNetworkHistoryEdgeBatch(edges);
        lastEdgeAt = now;
      }
    }
  }
}

function checkSpike(): void {
  const store = useStore();
  if (!store.ndisRunning) {
    return;
  }
  const metrics = readLiveMetrics();
  if (!metrics || metrics.latencyMs <= 0) {
    return;
  }
  const prev = lastLatencyMs;
  lastLatencyMs = metrics.latencyMs;
  if (prev == null || prev <= 0) {
    return;
  }
  const jumpedAbs = metrics.latencyMs - prev >= SPIKE_ABS_MS;
  const jumpedRel = metrics.latencyMs / prev >= SPIKE_RATIO;
  if (!jumpedAbs && !jumpedRel) {
    return;
  }
  void writeSample({ spike: true, force: true }).catch(() => undefined);
}

/**
 * Background recorder: 30s samples + spike samples while traffic routing is on.
 * Safe to call multiple times; starts once per app session.
 */
export function useNetworkHistoryRecorder() {
  function start() {
    if (recorderStarted || typeof window === "undefined") {
      return;
    }
    recorderStarted = true;

    sampleTimer = setInterval(() => {
      void writeSample({ force: true }).catch(() => undefined);
    }, SAMPLE_INTERVAL_MS);

    spikeTimer = setInterval(() => {
      checkSpike();
    }, SPIKE_CHECK_INTERVAL_MS);

    void writeSample({ force: true }).catch(() => undefined);
  }

  function stop() {
    if (sampleTimer) {
      clearInterval(sampleTimer);
      sampleTimer = null;
    }
    if (spikeTimer) {
      clearInterval(spikeTimer);
      spikeTimer = null;
    }
    recorderStarted = false;
    lastLatencyMs = null;
    lastSampleAt = 0;
    lastEdgeAt = 0;
  }

  return { start, stop };
}
