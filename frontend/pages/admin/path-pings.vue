<script setup lang="ts">
import type { DataTableHeader } from "vuetify";
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import {
  ListPathPings,
  ProbePath,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { PathPingRow } from "~/bindings/github.com/lagzap/lagzap/adapter";

definePageMeta({
  layout: "admin",
  sanctum: {
    excluded: true,
  },
});

type KindFilter = "all" | "user_edge" | "edge_edge" | "edge_relay";

const rows = ref<PathPingRow[]>([]);
const loading = ref(false);
const searching = ref("");
const kindFilter = ref<KindFilter>("all");
const pinging = ref<Record<string, boolean>>({});
const error = ref("");

const kindLabels: Record<string, string> = {
  user_edge: "User → Edge",
  edge_edge: "Edge → Edge",
  edge_relay: "Edge → Relay",
};

const headers = computed<DataTableHeader[]>(() => [
  { title: "Kind", key: "kind", align: "start", nowrap: true, width: "130px" },
  { title: "From", key: "from_name", align: "start", nowrap: true },
  { title: "To", key: "to_name", align: "start", nowrap: true },
  {
    title: "Avg",
    key: "avg_latency",
    align: "center",
    nowrap: true,
    width: "90px",
  },
  {
    title: "Min",
    key: "min_latency",
    align: "center",
    nowrap: true,
    width: "80px",
  },
  {
    title: "Max",
    key: "max_latency",
    align: "center",
    nowrap: true,
    width: "80px",
  },
  {
    title: "Loss",
    key: "packet_loss",
    align: "center",
    nowrap: true,
    width: "80px",
  },
  {
    title: "Proto",
    key: "proto",
    align: "center",
    nowrap: true,
    width: "100px",
  },
  {
    title: "Source",
    key: "source",
    align: "center",
    nowrap: true,
    width: "90px",
  },
  {
    title: "",
    key: "actions",
    align: "center",
    nowrap: true,
    width: "100px",
    sortable: false,
  },
]);

const items = computed(() => {
  const list = rows.value ?? [];
  if (kindFilter.value === "all") return list;
  return list.filter((r) => r.kind === kindFilter.value);
});

const counts = computed(() => {
  const c = { all: 0, user_edge: 0, edge_edge: 0, edge_relay: 0 };
  for (const r of rows.value ?? []) {
    c.all++;
    if (r.kind in c) c[r.kind as KindFilter]++;
  }
  return c;
});

function formatMs(value?: number) {
  if (value == null || value <= 0) return "—";
  return `${Number(value).toFixed(0)}ms`;
}

function formatLoss(value?: number) {
  if (value == null || value < 0) return "—";
  return `${Number(value).toFixed(0)}%`;
}

function protoLabel(row: PathPingRow) {
  const parts: string[] = [];
  if (row.udp) parts.push("udp");
  if (row.tcp) parts.push("tcp");
  if (row.icmp) parts.push("icmp");
  return parts.length ? parts.join("/") : "—";
}

function sourceColor(source?: string) {
  switch (source) {
    case "client":
      return "primary";
    case "chain":
      return "success";
    case "server":
      return "secondary";
    default:
      return "default";
  }
}

function kindColor(kind?: string) {
  switch (kind) {
    case "user_edge":
      return "info";
    case "edge_edge":
      return "warning";
    case "edge_relay":
      return "primary";
    default:
      return "default";
  }
}

async function load(refresh = false) {
  loading.value = true;
  error.value = "";
  try {
    const result = await ListPathPings(refresh);
    rows.value = result ?? [];
  } catch (e: any) {
    error.value = e?.message || String(e);
  } finally {
    loading.value = false;
  }
}

async function pingRow(row: PathPingRow) {
  if (!row?.key || pinging.value[row.key]) return;
  pinging.value = { ...pinging.value, [row.key]: true };
  error.value = "";
  try {
    const updated = await ProbePath(row.kind, row.from_id, row.to_id);
    if (updated?.key) {
      const idx = rows.value.findIndex((r) => r.key === updated.key);
      if (idx >= 0) {
        rows.value[idx] = updated;
      } else {
        rows.value = [...rows.value, updated];
      }
    }
  } catch (e: any) {
    error.value = e?.message || String(e);
  } finally {
    const next = { ...pinging.value };
    delete next[row.key];
    pinging.value = next;
  }
}

onMounted(() => {
  void load(true);
});
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">Path Pings</v-app-bar-title>
      </template>

      <v-toolbar class="bg-transparent px-3">
        <v-text-field
          v-model="searching"
          variant="solo-filled"
          rounded="xl"
          density="compact"
          label="Search"
          prepend-inner-icon="mdi-magnify"
          hide-details
          single-line
          style="max-width: 220px"
        />
        <v-btn-toggle
          v-model="kindFilter"
          class="ms-3"
          density="compact"
          color="primary"
          rounded="xl"
          group
        >
          <v-btn value="all" size="small">All ({{ counts.all }})</v-btn>
          <v-btn value="user_edge" size="small"
            >User→Edge ({{ counts.user_edge }})</v-btn
          >
          <v-btn value="edge_edge" size="small"
            >Edge→Edge ({{ counts.edge_edge }})</v-btn
          >
          <v-btn value="edge_relay" size="small"
            >Edge→Relay ({{ counts.edge_relay }})</v-btn
          >
        </v-btn-toggle>
        <v-spacer />
        <v-btn
          prepend-icon="mdi-refresh"
          variant="tonal"
          rounded="xl"
          density="comfortable"
          :loading="loading"
          @click="load(true)"
        >
          Refresh matrix
        </v-btn>
      </v-toolbar>

      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        density="compact"
        class="ma-3"
        closable
        @click:close="error = ''"
      >
        {{ error }}
      </v-alert>

      <v-data-table-virtual
        :search="searching"
        :headers="headers"
        :items="items"
        item-value="key"
        density="compact"
        multi-sort
        fixed-header
        hide-default-footer
        :loading="loading"
        :height="$vuetify.display.height - 120"
        class="bg-transparent"
      >
        <template #item.kind="{ item }">
          <v-chip
            size="x-small"
            :color="kindColor(item.kind)"
            variant="tonal"
          >
            {{ kindLabels[item.kind] || item.kind }}
          </v-chip>
        </template>

        <template #item.from_name="{ item }">
          <div class="d-flex align-center flex-nowrap ga-1">
            <CountryFlag
              v-if="item.from_country"
              :country="item.from_country"
              size="small"
            />
            <div class="d-flex flex-column">
              <span class="text-body-2">{{
                item.kind === "user_edge" && item.iface
                  ? item.iface
                  : item.from_name || "—"
              }}</span>
              <span class="text-caption text-medium-emphasis">{{
                item.kind === "user_edge" && item.iface
                  ? "Your NIC"
                  : item.from_city
              }}</span>
            </div>
          </div>
        </template>

        <template #item.to_name="{ item }">
          <div class="d-flex align-center flex-nowrap ga-1">
            <CountryFlag
              v-if="item.to_country"
              :country="item.to_country"
              size="small"
            />
            <div class="d-flex flex-column">
              <span class="text-body-2">{{ item.to_name || "—" }}</span>
              <span class="text-caption text-medium-emphasis">{{
                item.to_city
              }}</span>
            </div>
          </div>
        </template>

        <template #item.avg_latency="{ item }">
          <span :class="item.ok ? '' : 'text-error'">{{
            formatMs(item.avg_latency)
          }}</span>
        </template>

        <template #item.min_latency="{ item }">
          {{ formatMs(item.min_latency) }}
        </template>

        <template #item.max_latency="{ item }">
          {{ formatMs(item.max_latency) }}
        </template>

        <template #item.packet_loss="{ item }">
          {{ formatLoss(item.packet_loss) }}
        </template>

        <template #item.proto="{ item }">
          <span class="text-caption">{{ protoLabel(item) }}</span>
        </template>

        <template #item.source="{ item }">
          <v-chip
            size="x-small"
            :color="sourceColor(item.source)"
            variant="tonal"
          >
            {{ item.source || "—" }}
          </v-chip>
        </template>

        <template #item.actions="{ item }">
          <v-btn
            size="small"
            variant="tonal"
            color="primary"
            rounded="xl"
            prepend-icon="mdi-lan-pending"
            :loading="!!pinging[item.key]"
            @click="pingRow(item)"
          >
            Ping
          </v-btn>
        </template>
      </v-data-table-virtual>
    </Container>
  </div>
</template>
