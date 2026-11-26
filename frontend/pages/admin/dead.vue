<script setup lang="ts">
import type { DataTableHeader } from "vuetify";
import Container from "~/components/layout/Container.vue";
import { ClearDeadServer, GetDeadServers } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { DeadServerRecord } from "~/bindings/github.com/lagzap/lagzap/adapter/models";

definePageMeta({
  layout: "admin",
  sanctum: {
    excluded: true,
  },
});

/** What LagZap avoids right now, live: relays dropped after the full verify,
 * servers whose paths as an edge come last, entries left out of one relay's
 * routes. Remove ends one, to test (a dropped relay is measured again). */
const records = ref<DeadServerRecord[]>([]);
const removing = ref("");
const now = ref(Date.now());

async function poll() {
  now.value = Date.now();
  try {
    records.value = (await GetDeadServers()) ?? [];
  } catch {
    // service not running yet
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void poll();
  timer = setInterval(poll, 2000);
});
onUnmounted(() => clearInterval(timer));

async function remove(r: DeadServerRecord) {
  const id = `${r.kind}:${r.key}`;
  removing.value = id;
  try {
    await ClearDeadServer(r.kind, r.key);
    await poll();
  } finally {
    removing.value = "";
  }
}

const kinds: Record<string, { label: string; color: string }> = {
  relay: { label: "Relay dropped", color: "error" },
  server: { label: "Edge last", color: "warning" },
  entry: { label: "Entry out", color: "info" },
};
const kind = (k: string) => kinds[k] ?? { label: k, color: "default" };

function ago(ms: number): string {
  if (!ms) return "-";
  const s = Math.max(0, Math.round((now.value - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
}

function left(ms: number): string {
  if (!ms) return "next analysis";
  const s = Math.max(0, Math.round((ms - now.value) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const headers: DataTableHeader[] = [
  { title: "Kind", key: "kind", width: 130 },
  { title: "Server", key: "server" },
  { title: "Relay", key: "relay" },
  { title: "Since", key: "since", width: 120 },
  { title: "Ends in", key: "until", width: 120 },
  { title: "Last alive", key: "last_alive", width: 120 },
  { title: "Paths", key: "paths", width: 70 },
  { title: "", key: "actions", width: 100, sortable: false },
];
</script>

<template>
  <div class="h-100">
    <Container>
      <Teleport defer to="#admin-bar-actions">
        <v-chip size="small" variant="tonal" v-tooltip="'What LagZap avoids right now; Remove ends one to test it'">
          {{ records.length }} avoided
        </v-chip>
      </Teleport>
      <v-data-table-virtual :headers="headers" :items="records" density="compact" fixed-header height="100%" class="h-100">
        <template v-slot:item.kind="{ item }">
          <v-chip :color="kind(item.kind).color" size="x-small" variant="tonal" v-tooltip="item.reason">
            {{ kind(item.kind).label }}
          </v-chip>
        </template>
        <template v-slot:item.server="{ item }">
          <div>{{ item.server_name || "-" }}</div>
          <div class="text-caption text-medium-emphasis">{{ item.server }}</div>
        </template>
        <template v-slot:item.relay="{ item }">
          <span v-if="item.relay">{{ item.relay_name || item.relay }}</span>
          <span v-else class="text-medium-emphasis">every relay</span>
          <span v-if="item.network" class="text-caption text-medium-emphasis ms-1">{{ item.network }}</span>
        </template>
        <template v-slot:item.since="{ item }">
          <span class="text-medium-emphasis">{{ ago(item.since) }}</span>
        </template>
        <template v-slot:item.until="{ item }">
          <span class="text-medium-emphasis">{{ left(item.until) }}</span>
        </template>
        <template v-slot:item.last_alive="{ item }">
          <span class="text-medium-emphasis">{{ ago(item.last_alive) }}</span>
        </template>
        <template v-slot:item.actions="{ item }">
          <v-btn
            size="small"
            variant="tonal"
            color="on-surface"
            class="text-none"
            :loading="removing === `${item.kind}:${item.key}`"
            @click="remove(item)"
          >
            Remove
          </v-btn>
        </template>
        <template #no-data>
          <div class="text-medium-emphasis py-6">Nothing avoided: every server is in use.</div>
        </template>
      </v-data-table-virtual>
    </Container>
  </div>
</template>
