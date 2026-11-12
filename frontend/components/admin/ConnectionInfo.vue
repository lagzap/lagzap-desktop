<script setup lang="ts">
import { computed, ref } from "vue";
import type { Connection } from "~/types/monitoring";

/** Admin Tools: a connection's details in a small card (route, relay,
 * latency, traffic) instead of its raw JSON, which "Copy JSON" still gives. */
const props = defineProps<{
  connection: Connection & { process_name?: string; title_name?: string; profile_name?: string };
}>();

const store = useStore();
const c = computed(() => props.connection);

const node = computed(() => (c.value.node_id ? store.nodes[c.value.node_id] : undefined));
const relayed = computed(() => !!c.value.relay_route || !!node.value);
const relayText = computed(() => {
  if (!relayed.value) return "Direct";
  const n = node.value;
  const where = n ? [n.name, n.country].filter(Boolean).join(" · ") : c.value.node_id ?? "";
  const addr = (c.value.relay_route as { addr?: string } | null)?.addr;
  return [where, addr].filter(Boolean).join(" — ");
});

const ms = (v?: number) => (v && v > 0 ? `${Math.round(v)} ms` : "-");
const latencyText = computed(() =>
  c.value.avg_latency > 0
    ? `${ms(c.value.avg_latency)} (${ms(c.value.min_latency)} – ${ms(c.value.max_latency)})`
    : "-",
);
const qualityText = computed(() => {
  const parts: string[] = [];
  if (c.value.jitter > 0) parts.push(`jitter ${ms(c.value.jitter)}`);
  if (c.value.packet_sent > 0) parts.push(`loss ${(c.value.packet_loss ?? 0).toFixed(1)}%`);
  return parts.join(" · ") || "-";
});

function since(start: number) {
  const secs = Math.max(0, Math.round((Date.now() - start) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

const rows = computed(() =>
  [
    ["Title", [c.value.title_name, c.value.profile_name].filter(Boolean).join(" · ")],
    ["Protocol", [c.value.protocol?.toUpperCase(), c.value.network?.toUpperCase(), c.value.type].filter(Boolean).join(" · ")],
    ["Source", `${c.value.source_ip}:${c.value.source_port}`],
    ["Destination", `${c.value.destination_ip}:${c.value.destination_port}${c.value.country_code ? ` (${c.value.country_code})` : ""}`],
    ["Host", c.value.host],
    ["Relay", relayText.value],
    ["Issue", c.value.relay_issue ? [c.value.relay_issue.code, c.value.relay_issue.detail].filter(Boolean).join(": ") : ""],
    ["Latency", latencyText.value],
    ["Quality", qualityText.value],
    ["Traffic", `↑ ${useHumanSize(c.value.upload || 0)}  ↓ ${useHumanSize(c.value.download || 0)}`],
    ["Speed", `↑ ${useHumanSpeed(c.value.upload_speed || 0)}  ↓ ${useHumanSpeed(c.value.download_speed || 0)}`],
    ["Started", `${new Date(c.value.start).toLocaleTimeString()} · ${since(c.value.start)} ago`],
    ["Rule", c.value.rule],
  ].filter(([, value]) => !!value && value !== "-") as [string, string][],
);

const copied = ref(false);
async function copyJson() {
  try {
    await navigator.clipboard.writeText(JSON.stringify(c.value, null, 2));
    copied.value = true;
    setTimeout(() => (copied.value = false), 1200);
  } catch {
    // clipboard refused
  }
}
</script>

<template>
  <v-menu location="end" :close-on-content-click="false" offset="6">
    <template #activator="{ props: menu }">
      <v-btn
        v-bind="menu"
        icon
        variant="text"
        size="x-small"
        density="comfortable"
        class="text-medium-emphasis"
        aria-label="Connection details"
        @click.stop
      >
        <v-icon icon="mdi-information-outline" size="16" />
      </v-btn>
    </template>

    <v-card width="380" rounded="lg" border class="connection-info">
      <div class="px-4 pt-3 pb-2">
        <div class="text-subtitle-2 text-truncate">{{ c.process_name || c.process || "Connection" }}</div>
        <div v-if="c.process" class="text-caption text-medium-emphasis text-truncate" :title="c.process">
          {{ c.process }}
        </div>
      </div>
      <v-divider />
      <div class="px-4 py-2 connection-info__rows">
        <template v-for="[label, value] in rows" :key="label">
          <span class="text-caption text-medium-emphasis">{{ label }}</span>
          <span class="text-caption connection-info__value" :class="{ 'text-warning': label === 'Issue' }">{{ value }}</span>
        </template>
      </div>
      <v-divider />
      <div class="d-flex justify-end px-2 py-1">
        <v-btn
          size="small"
          variant="text"
          :prepend-icon="copied ? 'mdi-check' : 'mdi-code-json'"
          :color="copied ? 'success' : undefined"
          @click="copyJson"
        >
          Copy JSON
        </v-btn>
      </div>
    </v-card>
  </v-menu>
</template>

<style scoped>
.connection-info__rows {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 16px;
  row-gap: 4px;
}

.connection-info__value {
  min-width: 0;
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
