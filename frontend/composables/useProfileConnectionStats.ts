import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  toValue,
  watch,
  type MaybeRefOrGetter,
} from "vue";
import type { Connection } from "~/types/monitoring";
import { useMonitoringStore } from "~/stores/monitoring";

export type ProfileSpeedSample = {
  t: number;
  download: number;
  upload: number;
};

const MAX_SPEED_HISTORY = 90;
const SPEED_SAMPLE_MS = 1000;

/**
 * One logical flow can be mirrored across route×iface legs. Keep a single
 * speed/total per flow so multipath does not multiply usage.
 */
export function uniqueFlowStats(connections: Connection[]): {
  downloadSpeed: number;
  uploadSpeed: number;
  downloadBytes: number;
  uploadBytes: number;
  flowCount: number;
} {
  const byFlow = new Map<
    string,
    {
      downloadSpeed: number;
      uploadSpeed: number;
      downloadBytes: number;
      uploadBytes: number;
    }
  >();

  for (const connection of connections) {
    const key =
      connection.group_id ||
      [
        connection.process || "",
        connection.destination_ip || "",
        connection.destination_port || "",
        connection.network || "",
      ].join("|");
    const downloadSpeed = Math.abs(connection.download_speed || 0);
    const uploadSpeed = Math.abs(connection.upload_speed || 0);
    const downloadBytes = Math.abs(connection.download || 0);
    const uploadBytes = Math.abs(connection.upload || 0);
    const existing = byFlow.get(key);
    if (!existing) {
      byFlow.set(key, {
        downloadSpeed,
        uploadSpeed,
        downloadBytes,
        uploadBytes,
      });
      continue;
    }
    existing.downloadSpeed = Math.max(existing.downloadSpeed, downloadSpeed);
    existing.uploadSpeed = Math.max(existing.uploadSpeed, uploadSpeed);
    existing.downloadBytes = Math.max(existing.downloadBytes, downloadBytes);
    existing.uploadBytes = Math.max(existing.uploadBytes, uploadBytes);
  }

  let downloadSpeed = 0;
  let uploadSpeed = 0;
  let downloadBytes = 0;
  let uploadBytes = 0;
  for (const sample of byFlow.values()) {
    downloadSpeed += sample.downloadSpeed;
    uploadSpeed += sample.uploadSpeed;
    downloadBytes += sample.downloadBytes;
    uploadBytes += sample.uploadBytes;
  }
  return {
    downloadSpeed,
    uploadSpeed,
    downloadBytes,
    uploadBytes,
    flowCount: byFlow.size,
  };
}

/** Live connection + traffic summary for one profile row. */
export function useProfileConnectionStats(
  profileId: MaybeRefOrGetter<string>
) {
  const { connections } = useMonitoringStore();

  const profileConnections = computed(() =>
    (connections.value ?? []).filter(
      (connection) => connection.profile_id === toValue(profileId)
    )
  );

  const stats = computed(() => uniqueFlowStats(profileConnections.value));

  const connected = computed(() => profileConnections.value.length > 0);
  const flowing = computed(
    () => stats.value.downloadSpeed + stats.value.uploadSpeed > 256
  );

  const speedHistory = ref<ProfileSpeedSample[]>([]);
  let lastSampleAt = 0;
  let idleTimer: ReturnType<typeof setInterval> | undefined;

  function pushSpeedSample(download: number, upload: number, force = false) {
    const now = Date.now();
    if (!force && now - lastSampleAt < SPEED_SAMPLE_MS) {
      return;
    }
    lastSampleAt = now;
    speedHistory.value = [
      ...speedHistory.value,
      { t: now, download, upload },
    ].slice(-MAX_SPEED_HISTORY);
  }

  watch(
    () => [stats.value.downloadSpeed, stats.value.uploadSpeed] as const,
    ([download, upload]) => {
      if (download + upload <= 0 && speedHistory.value.length === 0) {
        return;
      }
      pushSpeedSample(download, upload);
    }
  );

  onMounted(() => {
    idleTimer = setInterval(() => {
      if (speedHistory.value.length === 0) {
        return;
      }
      const last = speedHistory.value[speedHistory.value.length - 1];
      if (!last) {
        return;
      }
      if (stats.value.downloadSpeed + stats.value.uploadSpeed > 0) {
        return;
      }
      if (Date.now() - last.t < SPEED_SAMPLE_MS) {
        return;
      }
      pushSpeedSample(0, 0, true);
    }, SPEED_SAMPLE_MS);
  });

  onUnmounted(() => {
    if (idleTimer != null) {
      clearInterval(idleTimer);
    }
  });

  return {
    profileConnections,
    connected,
    flowing,
    flowCount: computed(() => stats.value.flowCount),
    downloadSpeed: computed(() => stats.value.downloadSpeed),
    uploadSpeed: computed(() => stats.value.uploadSpeed),
    downloadBytes: computed(() => stats.value.downloadBytes),
    uploadBytes: computed(() => stats.value.uploadBytes),
    totalBytes: computed(
      () => stats.value.downloadBytes + stats.value.uploadBytes
    ),
    speedHistory: computed(() => speedHistory.value),
  };
}
