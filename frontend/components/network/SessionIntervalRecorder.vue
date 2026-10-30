<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { Events } from "@wailsio/runtime";
import { saveSessionInterval, type SessionInterval } from "~/utils/indexedDB";

/** Keeps Go's session-quality intervals ("stats-interval": every 5 minutes for
 * games, 10 for other profiles) in IndexedDB on this PC. Go also uploads them
 * with the connection statistics. */
function onInterval({ data }: any) {
  const raw = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (!raw || typeof raw !== "object" || !raw.session_id) return;
  void saveSessionInterval(raw as Omit<SessionInterval, "id">).catch((error) =>
    console.warn("Could not store session interval:", error),
  );
}

let off: (() => void) | undefined;
onMounted(() => {
  off = Events.On("stats-interval", onInterval);
});
onUnmounted(() => off?.());
</script>

<template>
  <span v-if="false" />
</template>
