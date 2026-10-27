<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import {
  ForceProbeRelay,
  GetNodes,
  GetRoutes,
  ProbeNodeRoutes,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type {
  Node,
  NodeRoute,
  RelayRoute,
} from "~/bindings/github.com/lagzap/zap/data";
import {
  combineAndRankRoutes,
  stickyCombineAndRankRoutes,
  nodeRoutePathKey,
  relayRoutesForNode,
  routeTransportOf,
} from "~/composables/useProfileDisplayRoutes";
import { useMonitoringStore } from "~/stores/monitoring";

definePageMeta({
  layout: "admin",
  sanctum: {
    excluded: true,
  },
});

type ViewMode = "combined" | "udp" | "tcp" | "sections";
type SectionKey = "ipv4-udp" | "ipv4-tcp" | "ipv6-udp" | "ipv6-tcp";

const SECTION_KEYS: SectionKey[] = [
  "ipv4-udp",
  "ipv4-tcp",
  "ipv6-udp",
  "ipv6-tcp",
];

const ROUTE_SUFFIX_RE = /-(ipv4|ipv6)-(udp|tcp)$/;

type RelaySection = {
  key: string;
  suffix: SectionKey;
  addr: string;
  routes: NodeRoute[];
};

type RelayBoard = {
  nodeId: string;
  name: string;
  city: string;
  country: string;
  addr: string;
  routeCount: number;
  bestMs: number | null;
  sections: RelaySection[];
  udpCount: number;
  tcpCount: number;
};

type DisplayRow = {
  key: string;
  section: string;
  transport: "tcp" | "udp";
  path: string;
  hops: string;
  avg: number;
  min: number;
  max: number;
  loss: number;
  jitter: number;
  score: number;
  liveMs: number | null;
  liveAgeMs: number | null;
};

const cache = ref<Record<string, RelayRoute>>({});
const nodes = ref<Record<string, Node>>({});
const loading = ref(false);
const probing = ref(false);
const error = ref("");
const searching = ref("");
const viewMode = ref<ViewMode>("combined");
const selectedId = ref("");
const nowMs = ref(Date.now());

const { routeProbeHistory, connections } = useMonitoringStore();

let tick: ReturnType<typeof setInterval> | null = null;

function cityLabel(city?: Record<string, string> | null): string {
  if (!city || typeof city !== "object") return "";
  return city.en || city.fa || Object.values(city)[0] || "";
}

function relayTagsMatch(connTag: string, nodeId: string): boolean {
  if (!connTag || !nodeId) return false;
  if (connTag === nodeId) return true;
  return connTag.startsWith(`${nodeId}-`) || nodeId.startsWith(`${connTag}-`);
}

/** Exact dialed paths on live connections for this relay (same as profile). */
function liveSessionRoutesForNode(nodeId: string): NodeRoute[] {
  const pool: NodeRoute[] = [];
  const seen = new Set<string>();
  for (const connection of connections.value ?? []) {
    const rr = connection.relay_route;
    if (!rr?.routes?.length) continue;
    if (!relayTagsMatch(rr.tag || connection.node_id || "", nodeId)) continue;
    const dialed =
      connection.network === "tcp" || connection.network === "udp"
        ? connection.network
        : null;
    for (const route of rr.routes) {
      const stamped = dialed ? tagTransport(route, dialed) : route;
      const key = `${dialed || routeTransportOf(stamped)}|${nodeRoutePathKey(stamped)}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      pool.push(stamped);
    }
  }
  // Admin: show every unique dialed path — do not clamp to profile slot max.
  return stickyCombineAndRankRoutes(
    pool,
    Math.max(pool.length, 1),
    `admin-relay|${nodeId}`
  );
}

function parseCacheKey(
  key: string
): { nodeId: string; suffix: SectionKey } | null {
  const m = key.match(ROUTE_SUFFIX_RE);
  if (!m) return null;
  return {
    nodeId: key.slice(0, -m[0].length),
    suffix: `${m[1]}-${m[2]}` as SectionKey,
  };
}

function formatMs(value?: number | null) {
  if (value == null || value <= 0) return "—";
  return `${Number(value).toFixed(0)}ms`;
}

function formatLoss(value?: number | null) {
  if (value == null || value < 0) return "—";
  return `${Number(value).toFixed(0)}%`;
}

function formatAge(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1500) return "now";
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  return `${Math.floor(ms / 60_000)}m`;
}

function shortPath(path?: string) {
  if (!path) return "—";
  if (path.length <= 64) return path;
  return `${path.slice(0, 28)}…${path.slice(-28)}`;
}

function hopLabel(route: NodeRoute): string {
  const hops = route.hops ?? [];
  if (!hops.length) return "—";
  return hops
    .map((h) => {
      const lat = h.latency && h.latency > 0 ? `${h.latency}ms` : "";
      return lat ? `${h.ip} (${lat})` : h.ip || "?";
    })
    .join(" → ");
}

function bestLatency(routes: NodeRoute[]): number | null {
  let best: number | null = null;
  for (const r of routes) {
    if ((r.packet_loss ?? 0) >= 100) continue;
    const ms = r.min_latency || r.avg_latency || 0;
    if (ms > 0 && (best == null || ms < best)) best = ms;
  }
  return best;
}

function tagTransport(route: NodeRoute, network: "tcp" | "udp"): NodeRoute {
  return {
    ...route,
    hops: (route.hops ?? []).map((h) => ({ ...h })),
    tcp_available: network === "tcp",
    udp_available: network === "udp",
  } as NodeRoute;
}

function sortByLatency(routes: NodeRoute[]): NodeRoute[] {
  return [...routes].sort((a, b) => {
    const aDead = (a.packet_loss ?? 0) >= 100 || !(a.min_latency || a.avg_latency);
    const bDead = (b.packet_loss ?? 0) >= 100 || !(b.min_latency || b.avg_latency);
    if (aDead !== bDead) return aDead ? 1 : -1;
    const la = a.min_latency || a.avg_latency || Infinity;
    const lb = b.min_latency || b.avg_latency || Infinity;
    return la - lb;
  });
}

const boards = computed<RelayBoard[]>(() => {
  const byNode = new Map<string, RelayBoard>();

  for (const [key, rr] of Object.entries(cache.value ?? {})) {
    const parsed = parseCacheKey(key);
    if (!parsed) continue;
    const routes = (rr?.routes ?? []).filter(Boolean) as NodeRoute[];
    if (!routes.length && !rr?.addr) continue;

    let board = byNode.get(parsed.nodeId);
    if (!board) {
      const node = nodes.value[parsed.nodeId];
      board = {
        nodeId: parsed.nodeId,
        name: node?.name || parsed.nodeId,
        city: cityLabel(node?.city as Record<string, string> | undefined),
        country: node?.country || "",
        addr: rr?.addr || "",
        routeCount: 0,
        bestMs: null,
        sections: [],
        udpCount: 0,
        tcpCount: 0,
      };
      byNode.set(parsed.nodeId, board);
    }

    if (rr?.addr) board.addr = rr.addr;
    board.sections.push({
      key,
      suffix: parsed.suffix,
      addr: rr?.addr || board.addr,
      routes,
    });
    board.routeCount += routes.length;
    if (parsed.suffix.endsWith("udp")) board.udpCount += routes.length;
    if (parsed.suffix.endsWith("tcp")) board.tcpCount += routes.length;
  }

  for (const board of byNode.values()) {
    board.sections.sort(
      (a, b) =>
        SECTION_KEYS.indexOf(a.suffix) - SECTION_KEYS.indexOf(b.suffix)
    );
    const all = board.sections.flatMap((s) => s.routes);
    board.bestMs = bestLatency(all);
  }

  return [...byNode.values()].sort((a, b) => {
    const la = a.bestMs ?? Infinity;
    const lb = b.bestMs ?? Infinity;
    if (la !== lb) return la - lb;
    return a.name.localeCompare(b.name);
  });
});

const filteredBoards = computed(() => {
  const q = searching.value.trim().toLowerCase();
  if (!q) return boards.value;
  return boards.value.filter((b) => {
    return (
      b.nodeId.toLowerCase().includes(q) ||
      b.name.toLowerCase().includes(q) ||
      b.city.toLowerCase().includes(q) ||
      b.country.toLowerCase().includes(q) ||
      b.addr.toLowerCase().includes(q)
    );
  });
});

const selected = computed(() => {
  const id = selectedId.value;
  if (!id) return filteredBoards.value[0] ?? null;
  return (
    filteredBoards.value.find((b) => b.nodeId === id) ??
    boards.value.find((b) => b.nodeId === id) ??
    null
  );
});

watch(
  filteredBoards,
  (list) => {
    if (!list.length) {
      selectedId.value = "";
      return;
    }
    if (!list.some((b) => b.nodeId === selectedId.value)) {
      selectedId.value = list[0].nodeId;
    }
  },
  { immediate: true }
);

function liveLatencyFor(
  nodeId: string,
  pathKey: string,
  transport: "tcp" | "udp"
): { ms: number | null; ageMs: number | null } {
  const history = routeProbeHistory.value ?? {};
  const tagKeys = new Set<string>([
    nodeId,
    `${nodeId}-ipv4-${transport}`,
    `${nodeId}-ipv6-${transport}`,
  ]);
  // Probes are keyed by RelayRoute.Tag (often node ULID); boards use name.
  for (const connection of connections.value ?? []) {
    const tag = connection.relay_route?.tag || connection.node_id || "";
    if (!tag) continue;
    if (!relayTagsMatch(tag, nodeId)) continue;
    tagKeys.add(tag);
    tagKeys.add(`${tag}-ipv4-${transport}`);
    tagKeys.add(`${tag}-ipv6-${transport}`);
  }

  let events: (typeof history)[string] | undefined;
  for (const key of tagKeys) {
    if (history[key]?.length) {
      events = history[key];
      break;
    }
  }
  if (!events?.length) return { ms: null, ageMs: null };

  const last = events[events.length - 1];
  const ts = last?.timestamp ? new Date(last.timestamp).getTime() : NaN;
  const ageMs = Number.isFinite(ts) ? Math.max(0, nowMs.value - ts) : null;

  for (let i = events.length - 1; i >= 0; i--) {
    for (const slot of events[i]?.slots ?? []) {
      if (!(slot.latency > 0)) continue;
      if ((slot.packet_loss ?? 0) >= 100) continue;
      if (slot.path_key && slot.path_key !== pathKey) continue;
      if (
        slot.network &&
        slot.network !== transport &&
        slot.network !== "any"
      ) {
        continue;
      }
      return { ms: slot.latency, ageMs };
    }
  }
  return { ms: null, ageMs: null };
}

function toRows(
  routes: NodeRoute[],
  section: string,
  forced?: "tcp" | "udp"
): DisplayRow[] {
  return routes.map((route, index) => {
    const transport = forced ?? routeTransportOf(route);
    const path = nodeRoutePathKey(route);
    const live = liveLatencyFor(
      selected.value?.nodeId ?? "",
      path,
      transport
    );
    return {
      key: `${section}|${transport}|${path || index}`,
      section,
      transport,
      path,
      hops: hopLabel(route),
      avg: route.avg_latency ?? 0,
      min: route.min_latency ?? 0,
      max: route.max_latency ?? 0,
      loss: route.packet_loss ?? 0,
      jitter: route.jitter ?? 0,
      score: route.score ?? 0,
      liveMs: live.ms,
      liveAgeMs: live.ageMs,
    };
  });
}

const displaySections = computed(() => {
  const board = selected.value;
  if (!board) return [] as { title: string; rows: DisplayRow[] }[];

  if (viewMode.value === "sections") {
    return board.sections
      .filter((s) => s.routes.length > 0)
      .map((s) => ({
        title: s.suffix,
        rows: toRows(
          sortByLatency(s.routes),
          s.suffix,
          s.suffix.endsWith("tcp") ? "tcp" : "udp"
        ),
      }));
  }

  if (viewMode.value === "udp" || viewMode.value === "tcp") {
    const network = viewMode.value;
    const routes = sortByLatency(
      relayRoutesForNode(cache.value, board.nodeId, network).map((r) =>
        tagTransport(r, network)
      )
    );
    return [
      {
        title: network.toUpperCase(),
        rows: toRows(routes, network, network),
      },
    ];
  }

  // combined: prefer live connection routes (identical to profile) when present
  const session = liveSessionRoutesForNode(board.nodeId);
  if (session.length > 0) {
    return [
      {
        title: "Live session routes (connections)",
        rows: toRows(session, "session"),
      },
    ];
  }

  // Idle: full optimize cache Combined UDP + TCP
  const tcp = relayRoutesForNode(cache.value, board.nodeId, "tcp").map((r) =>
    tagTransport(r, "tcp")
  );
  const udp = relayRoutesForNode(cache.value, board.nodeId, "udp").map((r) =>
    tagTransport(r, "udp")
  );
  const mixed = sortByLatency([...tcp, ...udp]);
  return [
    {
      title: "Combined UDP + TCP (path cache)",
      rows: toRows(mixed, "combined"),
    },
  ];
});

const totals = computed(() => {
  let relays = boards.value.length;
  let routes = 0;
  let udp = 0;
  let tcp = 0;
  for (const b of boards.value) {
    routes += b.routeCount;
    udp += b.udpCount;
    tcp += b.tcpCount;
  }
  return { relays, routes, udp, tcp };
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [routeMap, nodeMap] = await Promise.all([GetRoutes(), GetNodes()]);
    cache.value = (routeMap as Record<string, RelayRoute>) ?? {};
    nodes.value = (nodeMap as Record<string, Node>) ?? {};
  } catch (e: any) {
    error.value = e?.message || String(e);
  } finally {
    loading.value = false;
  }
}

async function probeSelected() {
  const board = selected.value;
  if (!board || probing.value) return;
  probing.value = true;
  error.value = "";
  try {
    const pool =
      viewMode.value === "tcp"
        ? relayRoutesForNode(cache.value, board.nodeId, "tcp")
        : viewMode.value === "udp"
          ? relayRoutesForNode(cache.value, board.nodeId, "udp")
          : [
              ...relayRoutesForNode(cache.value, board.nodeId, "udp"),
              ...relayRoutesForNode(cache.value, board.nodeId, "tcp"),
            ];
    if (pool.length) {
      await ProbeNodeRoutes(pool, "");
    }
    await ForceProbeRelay(board.nodeId);
    await load();
  } catch (e: any) {
    error.value = e?.message || String(e);
  } finally {
    probing.value = false;
  }
}

onMounted(async () => {
  tick = setInterval(() => {
    nowMs.value = Date.now();
  }, 1000);
  await load();
  const { Events } = await import("@wailsio/runtime");
  Events.On("relay-routes", ({ data }: { data: unknown }) => {
    const payload = Array.isArray(data) ? data[0] : data;
    const raw = payload as Record<string, RelayRoute> | null | undefined;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    if (Object.keys(raw).length === 0) return;
    cache.value = {
      ...cache.value,
      ...raw,
    };
  });
});

onUnmounted(() => {
  if (tick) clearInterval(tick);
});
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">Relays</v-app-bar-title>
      </template>

      <v-toolbar class="bg-transparent px-3">
        <v-text-field
          v-model="searching"
          variant="solo-filled"
          rounded="xl"
          density="compact"
          label="Search relays"
          prepend-inner-icon="mdi-magnify"
          hide-details
          single-line
          style="max-width: 220px"
        />
        <v-btn-toggle
          v-model="viewMode"
          class="ms-3"
          density="compact"
          color="primary"
          rounded="xl"
          group
        >
          <v-btn value="combined" size="small">Combined</v-btn>
          <v-btn value="udp" size="small">UDP</v-btn>
          <v-btn value="tcp" size="small">TCP</v-btn>
          <v-btn value="sections" size="small">Sections</v-btn>
        </v-btn-toggle>
        <v-spacer />
        <v-chip size="small" variant="tonal" class="me-2">
          {{ totals.relays }} relays · {{ totals.routes }} routes
        </v-chip>
        <v-chip size="small" variant="tonal" class="me-2">
          udp {{ totals.udp }} / tcp {{ totals.tcp }}
        </v-chip>
        <v-btn
          class="me-2"
          prepend-icon="mdi-radar"
          variant="tonal"
          rounded="xl"
          density="comfortable"
          color="warning"
          :loading="probing"
          :disabled="!selected"
          @click="probeSelected"
        >
          Probe
        </v-btn>
        <v-btn
          prepend-icon="mdi-refresh"
          variant="tonal"
          rounded="xl"
          density="comfortable"
          :loading="loading"
          @click="load"
        >
          Refresh cache
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

      <v-row class="ma-0" dense>
        <v-col cols="12" md="3" class="pa-2">
          <v-card variant="outlined" class="bg-transparent">
            <v-list density="compact" nav>
              <v-list-subheader>Path cache relays</v-list-subheader>
              <v-list-item
                v-for="board in filteredBoards"
                :key="board.nodeId"
                :active="board.nodeId === selected?.nodeId"
                rounded="lg"
                @click="selectedId = board.nodeId"
              >
                <v-list-item-title class="text-body-2 d-flex align-center ga-2">
                  <CountryFlag
                    v-if="board.country"
                    :country="board.country"
                    size="small"
                  />
                  <span>{{ board.name }}</span>
                </v-list-item-title>
                <v-list-item-subtitle class="text-caption">
                  {{ formatMs(board.bestMs) }}
                  · {{ board.routeCount }} routes
                  <span v-if="board.city"> · {{ board.city }}</span>
                </v-list-item-subtitle>
              </v-list-item>
              <v-list-item
                v-if="!filteredBoards.length"
                title="No relay routes in cache"
                subtitle="Run optimize, then refresh"
              />
            </v-list>
          </v-card>
        </v-col>

        <v-col cols="12" md="9" class="pa-2">
          <template v-if="selected">
            <v-card variant="outlined" class="bg-transparent mb-2">
              <v-card-title class="d-flex flex-wrap align-center ga-2 py-2">
                <CountryFlag
                  v-if="selected.country"
                  :country="selected.country"
                  size="small"
                />
                <span>{{ selected.name }}</span>
                <v-chip size="x-small" variant="tonal" class="font-mono">
                  {{ selected.nodeId }}
                </v-chip>
                <v-chip size="x-small" variant="tonal">
                  {{ selected.addr || "no addr" }}
                </v-chip>
                <v-chip size="x-small" variant="tonal">
                  best {{ formatMs(selected.bestMs) }}
                </v-chip>
                <v-chip size="x-small" color="info" variant="tonal">
                  udp {{ selected.udpCount }}
                </v-chip>
                <v-chip size="x-small" color="warning" variant="tonal">
                  tcp {{ selected.tcpCount }}
                </v-chip>
              </v-card-title>
              <v-card-subtitle class="pb-2 text-caption">
                <template v-if="liveSessionRoutesForNode(selected.nodeId).length">
                  Live session routes from connections (same as profile) ·
                  {{ liveSessionRoutesForNode(selected.nodeId).length }} paths
                </template>
                <template v-else>
                  Idle path cache · sections
                  <span class="font-mono">
                    {{
                      selected.sections.map((s) => s.suffix).join(", ") || "none"
                    }}
                  </span>
                </template>
              </v-card-subtitle>
            </v-card>

            <v-card
              v-for="section in displaySections"
              :key="section.title"
              variant="outlined"
              class="bg-transparent mb-2"
            >
              <v-card-title class="text-body-2 py-2 d-flex align-center">
                <span>{{ section.title }}</span>
                <v-spacer />
                <span class="text-caption text-medium-emphasis">
                  {{ section.rows.length }} routes
                </span>
              </v-card-title>
              <v-table density="compact" class="bg-transparent">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Proto</th>
                    <th>Avg</th>
                    <th>Min</th>
                    <th>Max</th>
                    <th>Live</th>
                    <th>Loss</th>
                    <th>Jitter</th>
                    <th>Score</th>
                    <th>Path</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, idx) in section.rows" :key="row.key">
                    <td>{{ idx + 1 }}</td>
                    <td>
                      <v-chip
                        size="x-small"
                        :color="row.transport === 'udp' ? 'info' : 'warning'"
                        variant="tonal"
                      >
                        {{ row.transport }}
                      </v-chip>
                    </td>
                    <td>{{ formatMs(row.avg) }}</td>
                    <td class="font-weight-medium">{{ formatMs(row.min) }}</td>
                    <td>{{ formatMs(row.max) }}</td>
                    <td>
                      <template v-if="row.liveMs != null">
                        {{ formatMs(row.liveMs) }}
                        <span class="text-caption text-medium-emphasis d-block">
                          {{ formatAge(row.liveAgeMs) }}
                        </span>
                      </template>
                      <template v-else>—</template>
                    </td>
                    <td
                      :class="
                        row.loss >= 3
                          ? 'text-error'
                          : row.loss > 0
                            ? 'text-warning'
                            : ''
                      "
                    >
                      {{ formatLoss(row.loss) }}
                    </td>
                    <td>{{ row.jitter ? row.jitter.toFixed(0) : "—" }}</td>
                    <td>{{ row.score || "—" }}</td>
                    <td class="font-mono text-caption" :title="row.hops">
                      {{ shortPath(row.path) }}
                    </td>
                  </tr>
                  <tr v-if="!section.rows.length">
                    <td colspan="10" class="text-medium-emphasis text-caption">
                      No routes in this view
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </v-card>
          </template>
          <v-card v-else variant="outlined" class="bg-transparent pa-6">
            <div class="text-medium-emphasis">
              No optimized relay paths in cache yet. After path optimize
              finishes, hit Refresh cache.
            </div>
          </v-card>
        </v-col>
      </v-row>
    </Container>
  </div>
</template>
