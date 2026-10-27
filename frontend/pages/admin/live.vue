<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import { useMonitoringStore } from "~/stores/monitoring";
import type {
  Connection,
  RouteMonitoringData,
  RouteProbeEvent,
  RouteProbeSlotMetric,
} from "~/types/monitoring";
import { useHumanSpeed } from "~/composables/helper";
import { GetNodes } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { Node } from "~/bindings/github.com/lagzap/zap/data";

definePageMeta({
  layout: "admin",
  sanctum: {
    excluded: true,
  },
});

const { routes, connections, routeProbeHistory } = useMonitoringStore();

const nodesById = ref<Record<string, Node>>({});

const nowMs = ref(Date.now());
let tick: ReturnType<typeof setInterval> | null = null;
onMounted(async () => {
  tick = setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
  try {
    const map = await GetNodes();
    if (map && typeof map === "object") {
      nodesById.value = map as Record<string, Node>;
    }
  } catch {
    // Admin can still show tags until nodes load.
  }
});
onUnmounted(() => {
  if (tick) clearInterval(tick);
});

function cityOf(node: Node | undefined): string {
  if (!node?.city || typeof node.city !== "object") {
    return "";
  }
  return (
    (node.city as Record<string, string>).en ||
    Object.values(node.city as Record<string, string>)[0] ||
    ""
  );
}

function resolveNodeMeta(tag: string): { name: string; city: string; country: string } {
  const id = tag.replace(/-ipv[46]-(tcp|udp)$/i, "");
  const direct = nodesById.value[id] || nodesById.value[tag];
  if (direct) {
    return {
      name: direct.name || id,
      city: cityOf(direct),
      country: direct.country || "",
    };
  }
  for (const node of Object.values(nodesById.value)) {
    if (!node) continue;
    if (node.id === id || node.name === id || node.id === tag || node.name === tag) {
      return {
        name: node.name || id,
        city: cityOf(node),
        country: node.country || "",
      };
    }
  }
  return { name: "", city: "", country: "" };
}

function displayRelayLabel(tag: string, fallbackName?: string, fallbackCity?: string): string {
  const meta = resolveNodeMeta(tag);
  if (meta.city) return meta.city;
  if (meta.name) return meta.name;
  if (fallbackCity) return fallbackCity;
  if (fallbackName && fallbackName !== tag) return fallbackName;
  return tag;
}

const selectedTag = ref<string>("");

type LegRow = {
  key: string;
  slot: number;
  path: string;
  iface: string;
  network: string;
  latency: number | null;
  lastGood: number | null;
  loss: number;
  jitter: number;
  score: number;
  ageMs: number | null;
  status: "fresh" | "warm" | "stale" | "dead" | "missing" | "miss";
};

type RelayBoard = {
  tag: string;
  nodeName: string;
  city: string;
  address: string;
  connCount: number;
  upload: number;
  download: number;
  probeAgeMs: number | null;
  legs: LegRow[];
  bestMs: number | null;
  connections: Connection[];
  meta?: RouteMonitoringData;
};

function parseTs(value?: string): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function ageMs(ts: number | null): number | null {
  if (ts == null) return null;
  return Math.max(0, nowMs.value - ts);
}

function formatAge(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1500) return "now";
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s ago`;
  return `${Math.floor(ms / 60_000)}m ago`;
}

function formatMs(ms: number | null): string {
  if (ms == null || ms <= 0) return "—";
  return `${ms.toFixed(0)}ms`;
}

function shortPath(path?: string): string {
  if (!path) return "—";
  if (path.length <= 56) return path;
  return `${path.slice(0, 26)}…${path.slice(-26)}`;
}

function legStatus(age: number | null, latency: number | null): LegRow["status"] {
  if (latency == null || latency <= 0) return "missing";
  if (age == null) return "missing";
  if (age <= 3000) return "fresh";
  if (age <= 8000) return "warm";
  if (age <= 15000) return "stale";
  return "dead";
}

function statusColor(status: LegRow["status"]): string {
  switch (status) {
    case "fresh":
      return "success";
    case "warm":
      return "warning";
    case "stale":
      return "orange";
    case "dead":
    case "miss":
      return "error";
    default:
      return "grey";
  }
}

function lastProbe(tag: string): RouteProbeEvent | null {
  const history = routeProbeHistory.value ?? {};
  const direct = history[tag];
  if (direct?.length) {
    return direct[direct.length - 1] ?? null;
  }
  // Probes may be keyed by store tag (id-ipv4-udp) while boards use bare ULID.
  let best: RouteProbeEvent | null = null;
  for (const [key, events] of Object.entries(history)) {
    if (!events?.length) continue;
    if (
      key === tag ||
      key.startsWith(`${tag}-`) ||
      tag.startsWith(`${key}-`)
    ) {
      const last = events[events.length - 1] ?? null;
      if (!best || (last && last.timestamp > best.timestamp)) {
        best = last;
      }
    }
  }
  return best;
}

function lastGoodLatencyForSlot(
  tag: string,
  slot: RouteProbeSlotMetric
): number | null {
  const events = routeProbeHistory.value[tag];
  if (!events?.length) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    for (const candidate of events[i]?.slots ?? []) {
      if (!(candidate.latency > 0)) continue;
      if ((candidate.packet_loss ?? 0) >= 100) continue;
      if (slot.path_key && candidate.path_key === slot.path_key) {
        if (slot.iface && candidate.iface && slot.iface !== candidate.iface) {
          continue;
        }
        return candidate.latency;
      }
      if (
        candidate.slot === slot.slot &&
        (!slot.iface || !candidate.iface || slot.iface === candidate.iface)
      ) {
        return candidate.latency;
      }
    }
  }
  return null;
}

function buildLegs(event: RouteProbeEvent | null): LegRow[] {
  if (!event) return [];
  const eventAge = ageMs(parseTs(event.timestamp));
  const tag = event.route_tag || "";
  const slots = event.slots ?? [];
  return slots.map((slot: RouteProbeSlotMetric, index: number) => {
    const loss = slot.packet_loss ?? 0;
    const missed = !(slot.latency > 0) || loss >= 100;
    // Never invent latency on a miss — show "—" and keep lastGood separate.
    const latency = missed ? null : slot.latency;
    const lastGood = missed ? lastGoodLatencyForSlot(tag, slot) : null;
    return {
      key: `${slot.slot}-${slot.path_key ?? index}-${slot.iface ?? ""}-${slot.network ?? ""}`,
      slot: slot.slot,
      path: slot.path_key || "",
      iface: slot.iface || "default",
      network: slot.network || "—",
      latency,
      lastGood,
      loss,
      jitter: slot.jitter ?? 0,
      score: slot.score ?? 0,
      ageMs: eventAge,
      status: missed ? "miss" : legStatus(eventAge, latency),
    };
  });
}

const boards = computed<RelayBoard[]>(() => {
  const byTag = new Map<string, RelayBoard>();

  for (const conn of connections.value ?? []) {
    const tag = conn.relay_route?.tag || conn.node_id || "";
    if (!tag) continue;
    let board = byTag.get(tag);
    if (!board) {
      const meta = resolveNodeMeta(tag);
      board = {
        tag,
        nodeName: displayRelayLabel(tag),
        city: meta.city,
        address: conn.relay_route?.addr || "",
        connCount: 0,
        upload: 0,
        download: 0,
        probeAgeMs: null,
        legs: [],
        bestMs: null,
        connections: [],
      };
      byTag.set(tag, board);
    }
    board.connections.push(conn);
    board.connCount += 1;
    board.upload += Math.abs(conn.upload_speed || 0);
    board.download += Math.abs(conn.download_speed || 0);
  }

  for (const route of routes.value?.routes ?? []) {
    const tag = route.route_tag || route.node_id;
    if (!tag) continue;
    let board = byTag.get(tag);
    if (!board) {
      board = {
        tag,
        nodeName: displayRelayLabel(tag, route.node_name, route.city),
        city: route.city || resolveNodeMeta(tag).city,
        address: route.address || "",
        connCount: route.connections || 0,
        upload: 0,
        download: 0,
        probeAgeMs: null,
        legs: [],
        bestMs: null,
        connections: [],
        meta: route,
      };
      byTag.set(tag, board);
    } else {
      board.meta = route;
      board.nodeName = displayRelayLabel(
        tag,
        route.node_name || board.nodeName,
        route.city || board.city
      );
      board.city = route.city || board.city || resolveNodeMeta(tag).city;
      board.address = route.address || board.address;
    }
  }

  // Also include any probe-only tags so silent watched routes still show up.
  for (const tag of Object.keys(routeProbeHistory.value ?? {})) {
    if (!byTag.has(tag)) {
      const meta = resolveNodeMeta(tag);
      byTag.set(tag, {
        tag,
        nodeName: displayRelayLabel(tag),
        city: meta.city,
        address: "",
        connCount: 0,
        upload: 0,
        download: 0,
        probeAgeMs: null,
        legs: [],
        bestMs: null,
        connections: [],
      });
    }
  }

  const list: RelayBoard[] = [];
  for (const board of byTag.values()) {
    const probe = lastProbe(board.tag);
    board.probeAgeMs = ageMs(parseTs(probe?.timestamp));
    board.legs = buildLegs(probe);
    const live = board.legs
      .filter((leg) => leg.latency != null && leg.latency > 0 && leg.loss < 100)
      .map((leg) => leg.latency as number);
    board.bestMs = live.length ? Math.min(...live) : board.meta?.avg_latency || null;
    if (probe) {
      board.upload = Math.max(board.upload, Math.abs(probe.upload || 0));
      board.download = Math.max(board.download, Math.abs(probe.download || 0));
    }
    list.push(board);
  }

  return list.sort((a, b) => {
    if (b.connCount !== a.connCount) return b.connCount - a.connCount;
    return a.nodeName.localeCompare(b.nodeName);
  });
});

watch(
  boards,
  (list) => {
    if (!selectedTag.value && list.length) {
      selectedTag.value = list[0].tag;
      return;
    }
    if (selectedTag.value && !list.some((b) => b.tag === selectedTag.value) && list.length) {
      selectedTag.value = list[0].tag;
    }
  },
  { immediate: true }
);

const selected = computed(
  () => boards.value.find((b) => b.tag === selectedTag.value) ?? null
);

function processName(path?: string): string {
  if (!path) return "—";
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || path;
}
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          Live Relay Monitor
        </v-app-bar-title>
      </template>

      <v-toolbar class="bg-transparent px-3" density="compact">
        <v-chip size="small" variant="tonal" class="me-2">
          {{ boards.length }} relays
        </v-chip>
        <v-spacer />
        <span class="text-caption text-medium-emphasis">
          Numbers only · no chart timeouts · probe age ≠ game lag
        </span>
      </v-toolbar>

      <v-row class="ma-0" dense>
        <v-col cols="12" md="3" class="pa-2">
          <v-card variant="outlined" class="bg-transparent">
            <v-list density="compact" nav>
              <v-list-subheader>Active relays</v-list-subheader>
              <v-list-item
                v-for="board in boards"
                :key="board.tag"
                :active="board.tag === selectedTag"
                rounded="lg"
                @click="selectedTag = board.tag"
              >
                <v-list-item-title class="text-body-2">
                  {{ board.nodeName }}
                  <span v-if="board.city" class="text-medium-emphasis">
                    · {{ board.city }}
                  </span>
                </v-list-item-title>
                <v-list-item-subtitle class="text-caption">
                  {{ formatMs(board.bestMs) }}
                  · {{ board.connCount }} conn
                  · probe {{ formatAge(board.probeAgeMs) }}
                </v-list-item-subtitle>
              </v-list-item>
              <v-list-item v-if="!boards.length" title="No active relays" />
            </v-list>
          </v-card>

        </v-col>

        <v-col cols="12" md="9" class="pa-2">
          <template v-if="selected">
            <v-card variant="outlined" class="bg-transparent mb-2">
              <v-card-title class="d-flex flex-wrap align-center ga-2 py-2">
                <span>{{ selected.nodeName }}</span>
                <v-chip size="x-small" variant="tonal">
                  {{ selected.address || "no addr" }}
                </v-chip>
                <v-chip size="x-small" variant="tonal">
                  best {{ formatMs(selected.bestMs) }}
                </v-chip>
                <v-chip
                  size="x-small"
                  :color="
                    (selected.probeAgeMs ?? 99999) <= 3000 ? 'success' : 'warning'
                  "
                  variant="tonal"
                >
                  probe {{ formatAge(selected.probeAgeMs) }}
                </v-chip>
                <v-spacer />
                <span class="text-caption text-medium-emphasis">
                  ↑ {{ useHumanSpeed(selected.upload) }}
                  · ↓ {{ useHumanSpeed(selected.download) }}
                </span>
              </v-card-title>
              <v-card-subtitle class="pb-2 font-mono text-caption">
                {{ selected.tag }}
              </v-card-subtitle>
            </v-card>

            <v-card variant="outlined" class="bg-transparent mb-2">
              <v-card-title class="text-body-2 py-2">Legs (live probe)</v-card-title>
              <v-table density="compact" class="bg-transparent">
                <thead>
                  <tr>
                    <th>Slot</th>
                    <th>Status</th>
                    <th>Latency</th>
                    <th>Age</th>
                    <th>Loss</th>
                    <th>Jitter</th>
                    <th>Score</th>
                    <th>Net</th>
                    <th>Iface</th>
                    <th>Path</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="leg in selected.legs" :key="leg.key">
                    <td>{{ leg.slot }}</td>
                    <td>
                      <v-chip
                        size="x-small"
                        :color="statusColor(leg.status)"
                        variant="tonal"
                      >
                        {{ leg.status }}
                      </v-chip>
                    </td>
                    <td class="font-weight-medium">
                      <template v-if="leg.latency != null && leg.latency > 0">
                        {{ formatMs(leg.latency) }}
                      </template>
                      <template v-else>
                        —
                        <span
                          v-if="leg.lastGood"
                          class="text-caption text-medium-emphasis d-block"
                        >
                          last {{ formatMs(leg.lastGood) }}
                        </span>
                      </template>
                    </td>
                    <td>{{ formatAge(leg.ageMs) }}</td>
                    <td
                      :class="
                        leg.loss >= 3
                          ? 'text-error'
                          : leg.loss > 0
                            ? 'text-warning'
                            : ''
                      "
                    >
                      {{ leg.loss.toFixed(1) }}%
                    </td>
                    <td>{{ leg.jitter.toFixed(0) }}</td>
                    <td>{{ leg.score || "—" }}</td>
                    <td>{{ leg.network }}</td>
                    <td>{{ leg.iface }}</td>
                    <td class="font-mono text-caption">{{ shortPath(leg.path) }}</td>
                  </tr>
                  <tr v-if="!selected.legs.length">
                    <td colspan="10" class="text-medium-emphasis text-caption">
                      No probe slots yet for this relay
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </v-card>

            <v-card variant="outlined" class="bg-transparent">
              <v-card-title class="text-body-2 py-2">
                Connections ({{ selected.connections.length }})
              </v-card-title>
              <v-table density="compact" class="bg-transparent">
                <thead>
                  <tr>
                    <th>Process</th>
                    <th>Dest</th>
                    <th>Net</th>
                    <th>Ping</th>
                    <th>Speed</th>
                    <th>Path</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="conn in selected.connections" :key="conn.id">
                    <td>{{ processName(conn.process) }}</td>
                    <td class="font-mono text-caption">
                      {{ conn.destination_ip }}:{{ conn.destination_port }}
                    </td>
                    <td>{{ conn.network }}</td>
                    <td>{{ formatMs(conn.avg_latency || null) }}</td>
                    <td class="text-caption">
                      ↑ {{ useHumanSpeed(Math.abs(conn.upload_speed || 0)) }}
                      · ↓ {{ useHumanSpeed(Math.abs(conn.download_speed || 0)) }}
                    </td>
                    <td class="font-mono text-caption">
                      {{
                        shortPath(
                          conn.relay_route?.routes?.[0]?.hops
                            ?.map((h) => h.ip)
                            .join("->")
                        )
                      }}
                    </td>
                  </tr>
                  <tr v-if="!selected.connections.length">
                    <td colspan="6" class="text-medium-emphasis text-caption">
                      No live connections on this relay
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </v-card>
          </template>
          <v-card v-else variant="outlined" class="bg-transparent pa-6">
            <div class="text-medium-emphasis">
              Start a game connection to see live relay legs here.
            </div>
          </v-card>
        </v-col>
      </v-row>
    </Container>
  </div>
</template>
