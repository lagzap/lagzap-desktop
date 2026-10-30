<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { Events } from "@wailsio/runtime";
import { useRouteProtection } from "~/composables/useRouteProtection";

/** Records when LagZap moved a game off a path that stopped working before
 * the game noticed; the backend reports it as a "relay-path" event once the
 * new path receives. The profile card shows the note (useRouteProtection). */
const PROTECTED_KINDS = new Set(["route-swapped", "failover-promote"]);

const { mark } = useRouteProtection();

function onRelayPath({ data }: any) {
  const event = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (event && PROTECTED_KINDS.has(event.kind) && event.profile_id) {
    mark(event.profile_id);
  }
}

let off: (() => void) | undefined;
onMounted(() => {
  off = Events.On("relay-path", onRelayPath);
});
onUnmounted(() => off?.());
</script>

<template>
  <span v-if="false" />
</template>
