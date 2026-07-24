import { GetVersion } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import {
  clearNetworkHistory,
  getNetworkHistoryCounts,
  getNetworkHistoryEvents,
  getNetworkHistorySamples,
} from "~/utils/networkHistoryDB";
import {
  buildNetworkReport,
  buildUploadAggregate,
  NETWORK_REPORT_RANGE_MS,
  type NetworkReport,
  type NetworkReportRange,
  type NetworkUploadAggregate,
} from "~/utils/networkReport";

/** ~10 minutes at 30s sample interval */
export const NETWORK_REPORT_MIN_SAMPLES = 20;
/** Enough intervention signal if samples are borderline */
export const NETWORK_REPORT_MIN_EVENTS = 10;
/** Soft floor: never report below this many samples alone */
export const NETWORK_REPORT_ABS_MIN_SAMPLES = 10;

export function hasEnoughNetworkReportData(
  samples: number,
  events: number
): boolean {
  if (samples >= NETWORK_REPORT_MIN_SAMPLES) {
    return true;
  }
  return (
    samples >= NETWORK_REPORT_ABS_MIN_SAMPLES &&
    events >= NETWORK_REPORT_MIN_EVENTS
  );
}

export function useNetworkReport() {
  const range = ref<NetworkReportRange>("7d");
  const loading = ref(false);
  const clearing = ref(false);
  const report = ref<NetworkReport | null>(null);
  const uploadPreview = ref<NetworkUploadAggregate | null>(null);
  const error = ref<string | null>(null);
  const insufficient = ref(false);
  const counts = ref({ events: 0, samples: 0, usage: 0, edge: 0 });
  /** Counts for the selected range (not lifetime DB totals). */
  const rangeCounts = ref({ events: 0, samples: 0 });

  const canGenerate = computed(() =>
    hasEnoughNetworkReportData(
      rangeCounts.value.samples,
      rangeCounts.value.events
    )
  );

  async function refreshCounts() {
    try {
      counts.value = await getNetworkHistoryCounts();
    } catch {
      counts.value = { events: 0, samples: 0, usage: 0, edge: 0 };
    }
  }

  async function refreshRangeCounts() {
    const now = Date.now();
    const from = now - NETWORK_REPORT_RANGE_MS[range.value];
    try {
      const [events, samples] = await Promise.all([
        getNetworkHistoryEvents(from, now),
        getNetworkHistorySamples(from, now),
      ]);
      rangeCounts.value = {
        events: events.length,
        samples: samples.length,
      };
    } catch {
      rangeCounts.value = { events: 0, samples: 0 };
    }
  }

  async function generate() {
    loading.value = true;
    error.value = null;
    insufficient.value = false;
    try {
      await refreshRangeCounts();
      if (
        !hasEnoughNetworkReportData(
          rangeCounts.value.samples,
          rangeCounts.value.events
        )
      ) {
        insufficient.value = true;
        report.value = null;
        uploadPreview.value = null;
        return;
      }
      const next = await buildNetworkReport(range.value);
      report.value = next;
      let version: string | undefined;
      try {
        version = (await GetVersion()) || undefined;
      } catch {
        version = undefined;
      }
      uploadPreview.value = buildUploadAggregate(next, version);
      await refreshCounts();
    } catch (e) {
      error.value =
        e instanceof Error ? e.message : "Failed to generate report";
      report.value = null;
      uploadPreview.value = null;
    } finally {
      loading.value = false;
    }
  }

  async function clearHistory() {
    clearing.value = true;
    error.value = null;
    insufficient.value = false;
    try {
      await clearNetworkHistory();
      report.value = null;
      uploadPreview.value = null;
      rangeCounts.value = { events: 0, samples: 0 };
      await refreshCounts();
    } catch (e) {
      error.value =
        e instanceof Error ? e.message : "Failed to clear history";
    } finally {
      clearing.value = false;
    }
  }

  return {
    range,
    loading,
    clearing,
    report,
    uploadPreview,
    error,
    insufficient,
    counts,
    rangeCounts,
    canGenerate,
    refreshCounts,
    refreshRangeCounts,
    generate,
    clearHistory,
    minSamples: NETWORK_REPORT_MIN_SAMPLES,
  };
}
