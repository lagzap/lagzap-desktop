<script setup lang="ts">
import type { DataTableHeader } from "vuetify";
import Container from "~/components/layout/Container.vue";
import { useMonitoringStore } from "~/stores/monitoring";
import type { LagFixEvent, RelayPathEvent } from "~/types/monitoring";

const { lagFixHistory, lagFixStats, relayPathEvents, routeProbeHistory } =
  useMonitoringStore();

const filter = ref<"all" | "swaps" | "skips" | "redials">("all");

type TimelineRow = {
  id: string;
  at: string;
  kind: string;
  status: string;
  route: string;
  detail: string;
  reason: string;
  userSide: boolean;
  internetMs: string;
  source: "lag-fix" | "relay-path";
  raw?: LagFixEvent | RelayPathEvent;
};

function fmtTime(value?: string) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString();
}

function shortPath(path?: string) {
  if (!path) return "-";
  if (path.length <= 48) return path;
  return path.slice(0, 22) + "…" + path.slice(-22);
}

const timeline = computed<TimelineRow[]>(() => {
  const swaps: TimelineRow[] = (lagFixHistory.value ?? []).map((fix) => ({
    id: fix.id,
    at: fix.timestamp,
    kind: fix.status === "skipped" ? "skip" : "swap",
    status: fix.status,
    route: fix.route_tag,
    detail:
      fix.status === "skipped"
        ? shortPath(fix.old_path_key) || "no path"
        : `${shortPath(fix.old_path_key)} → ${shortPath(fix.new_path_key)}`,
    reason: fix.reason || "",
    userSide: !!fix.user_side_lag,
    internetMs:
      fix.global_before?.avg_latency > 0
        ? `${fix.global_before.avg_latency.toFixed(0)}ms`
        : "-",
    source: "lag-fix",
    raw: fix,
  }));

  const redials: TimelineRow[] = (relayPathEvents.value ?? []).map((event) => ({
    id: event.id,
    at: event.timestamp,
    kind: event.kind,
    status: event.kind,
    route: event.route_tag || event.conn_uuid || "-",
    detail: `${event.entry || "?"} @ ${event.iface || "default"} (${
      event.is_tcp ? "tcp" : "udp"
    })`,
    reason: event.destination || "",
    userSide: false,
    internetMs: "-",
    source: "relay-path",
    raw: event,
  }));

  return [...swaps, ...redials].sort((a, b) =>
    a.at > b.at ? -1 : a.at < b.at ? 1 : 0
  );
});

const filtered = computed(() => {
  switch (filter.value) {
    case "swaps":
      return timeline.value.filter(
        (row) => row.kind === "swap" || row.status === "pending"
      );
    case "skips":
      return timeline.value.filter((row) => row.status === "skipped");
    case "redials":
      return timeline.value.filter((row) => row.source === "relay-path");
    default:
      return timeline.value;
  }
});

const headers = computed<DataTableHeader[]>(() => [
  { title: "Time", key: "at", width: "90px" },
  { title: "Kind", key: "kind", width: "110px" },
  { title: "Status", key: "status", width: "100px" },
  { title: "Route / Conn", key: "route", width: "220px" },
  { title: "Detail", key: "detail" },
  { title: "Why", key: "reason", width: "180px" },
  { title: "User net", key: "userSide", width: "90px" },
  { title: "Internet", key: "internetMs", width: "90px" },
]);

const statusColor = (status: string) => {
  switch (status) {
    case "verified":
      return "success";
    case "pending":
      return "warning";
    case "failed":
      return "error";
    case "skipped":
      return "grey";
    case "silent-redial":
      return "orange";
    default:
      return "primary";
  }
};

const selected = ref<TimelineRow | null>(null);

const latestProbes = computed(() => {
  const tag = selected.value?.route;
  if (!tag || !routeProbeHistory.value[tag]) return [];
  const series = routeProbeHistory.value[tag];
  return series[series.length - 1]?.slots ?? [];
});

const howToRead = [
  {
    title: "swap pending → verified/failed",
    text: "Lag-fix actually changed one route slot. Verified = better after ~6s.",
  },
  {
    title: "skipped:no_candidate",
    text: "System wanted a new leg but had no alternate path. Stuck on bad path.",
  },
  {
    title: "skipped:cooldown",
    text: "Lag seen but swap blocked by 30s cooldown.",
  },
  {
    title: "user_side_lag / high Internet ms",
    text: "Your uplink adapter is lagging. Changing game legs cannot fix that.",
  },
  {
    title: "silent-redial",
    text: "Same entry/iface leg died (12s quiet) and was re-dialed — not a better-route pick.",
  },
];
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          Lag Fix / Path Events
        </v-app-bar-title>
      </template>

      <v-toolbar class="bg-transparent px-3" density="compact">
        <v-btn-toggle v-model="filter" mandatory density="compact" divided>
          <v-btn value="all" size="small">All</v-btn>
          <v-btn value="swaps" size="small">Swaps</v-btn>
          <v-btn value="skips" size="small">Skips</v-btn>
          <v-btn value="redials" size="small">Redials</v-btn>
        </v-btn-toggle>
        <v-spacer />
        <v-chip size="small" variant="outlined" class="me-2">
          attempts {{ lagFixStats.attempt_count }}
        </v-chip>
        <v-chip size="small" color="success" variant="outlined" class="me-2">
          verified {{ lagFixStats.verified_count }}
        </v-chip>
        <v-chip size="small" color="error" variant="outlined" class="me-2">
          failed {{ lagFixStats.failed_count }}
        </v-chip>
        <v-chip size="small" variant="tonal">
          saved {{ lagFixStats.total_improvement_ms?.toFixed?.(0) || 0 }}ms
        </v-chip>
      </v-toolbar>

      <v-row class="px-3 pb-2" dense>
        <v-col
          v-for="tip in howToRead"
          :key="tip.title"
          cols="12"
          md="4"
          lg="2"
        >
          <div class="text-caption font-weight-medium">{{ tip.title }}</div>
          <div class="text-caption text-medium-emphasis">{{ tip.text }}</div>
        </v-col>
      </v-row>

      <v-data-table-virtual
        :headers
        :items="filtered"
        item-key="id"
        density="compact"
        fixed-header
        hide-default-footer
        :height="$vuetify.display.height - 220"
        class="bg-transparent"
        @click:row="(_: any, ctx: any) => (selected = ctx.item)"
      >
        <template #item.at="{ item }">
          <span class="text-caption">{{ fmtTime(item.at) }}</span>
        </template>
        <template #item.kind="{ item }">
          <v-chip size="x-small" variant="tonal">{{ item.kind }}</v-chip>
        </template>
        <template #item.status="{ item }">
          <v-chip
            size="x-small"
            :color="statusColor(item.status)"
            variant="outlined"
          >
            {{ item.status }}
          </v-chip>
        </template>
        <template #item.route="{ item }">
          <span class="text-caption font-mono">{{ item.route }}</span>
        </template>
        <template #item.detail="{ item }">
          <span class="text-caption font-mono">{{ item.detail }}</span>
        </template>
        <template #item.reason="{ item }">
          <span class="text-caption">{{ item.reason || "-" }}</span>
        </template>
        <template #item.userSide="{ item }">
          <v-icon
            v-if="item.userSide"
            size="small"
            color="warning"
            title="Internet uplink lag detected"
          >
            mdi-home-alert
          </v-icon>
          <span v-else class="text-medium-emphasis">-</span>
        </template>
      </v-data-table-virtual>
    </Container>

    <v-navigation-drawer
      v-if="selected"
      location="right"
      temporary
      width="420"
      :model-value="!!selected"
      @update:model-value="(v: boolean) => !v && (selected = null)"
    >
      <v-toolbar density="compact" title="Event detail">
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" @click="selected = null" />
      </v-toolbar>
      <v-list density="compact" class="pa-3">
        <v-list-item
          title="Kind"
          :subtitle="`${selected.kind} / ${selected.status}`"
        />
        <v-list-item title="Reason" :subtitle="selected.reason || '-'" />
        <v-list-item title="Route" :subtitle="selected.route" />
        <v-list-item title="Detail" :subtitle="selected.detail" />
        <v-list-item
          title="User-side internet lag"
          :subtitle="selected.userSide ? 'yes — local uplink problem' : 'no'"
        />
        <v-list-item
          title="Internet ping then"
          :subtitle="selected.internetMs"
        />
        <template v-if="latestProbes.length">
          <v-list-subheader>Latest probe slots</v-list-subheader>
          <v-list-item
            v-for="slot in latestProbes"
            :key="`${slot.slot}-${slot.path_key}`"
            :title="`slot ${slot.slot} ${slot.network || ''} ${slot.iface || ''}`"
            :subtitle="`${shortPath(slot.path_key)} · ${slot.latency?.toFixed?.(0) ?? '-'}ms · loss ${slot.packet_loss?.toFixed?.(1) ?? 0}% · score ${slot.score || '-'}`"
          />
        </template>
        <v-list-subheader class="mt-2">Raw</v-list-subheader>
        <pre class="text-caption pa-2 overflow-auto" style="max-height: 240px">{{
          JSON.stringify(selected.raw, null, 2)
        }}</pre>
      </v-list>
    </v-navigation-drawer>
  </div>
</template>
