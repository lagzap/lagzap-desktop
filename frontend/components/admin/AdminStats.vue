<script setup lang="ts">
import * as echarts from "echarts";
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from "vue";
import { useLocale, useTheme } from "vuetify";
import { GetProfileStats, GetTitleStats } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { LiveStats } from "~/bindings/github.com/lagzap/lagzap/adapter";
import { listSessionIntervals, type SessionInterval } from "~/utils/indexedDB";
import { formatMs, formatSize, localDigits } from "~/utils/localeFormat";

/** Admins: a profile's or title's statistics as LagZap collects them — the
 * open sessions with the interval being summed up (live, from Go), and the
 * last day's finished intervals kept on this PC — with a chart. */
const props = defineProps<{ kind: "profile" | "title"; id: string }>();

const { t } = useLocale();
const theme = useTheme();
const store = useStore();
const live = shallowRef<LiveStats | null>(null);
const history = shallowRef<SessionInterval[]>([]);
const HISTORY_MS = 24 * 60 * 60 * 1000;

const profileIds = computed(() =>
  props.kind === "profile" ? [props.id] : store.profiles.filter((p) => p.title_id === props.id).map((p) => p.id),
);
const profileName = (id: string) => {
  const profile = store.profiles.find((p) => p.id === id);
  return profile ? store.localized(profile.name) : id;
};

async function refresh() {
  if (document.hidden || !props.id) return;
  const want = props.id;
  try {
    const got = await (props.kind === "profile" ? GetProfileStats(want) : GetTitleStats(want));
    if (want === props.id) live.value = got;
  } catch {
    // not an admin (any more) or the service is not running
  }
  try {
    const since = Date.now() - HISTORY_MS;
    const rows = (await Promise.all(profileIds.value.map((id) => listSessionIntervals(id, since)))).flat();
    rows.sort((a, b) => a.started_at - b.started_at);
    if (want === props.id) history.value = rows;
  } catch {
    // no local intervals
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
watch(
  () => props.id,
  () => {
    live.value = null;
    history.value = [];
    void refresh();
  },
  { immediate: true },
);
onMounted(() => (timer = setInterval(refresh, 2000)));
onUnmounted(() => clearInterval(timer));

const sessions = computed(() => live.value?.sessions ?? []);
const loss = (lat?: { samples?: number; lost?: number } | null) =>
  lat?.samples ? ((lat.lost ?? 0) / lat.samples) * 100 : 0;
const duration = (from: number, to = Date.now()) => {
  const s = Math.max(0, Math.round((to - from) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${localDigits(h)}h ${localDigits(m)}m` : `${localDigits(m)}m ${localDigits(s % 60)}s`;
};
const time = (at: number) => new Date(at).toLocaleTimeString();

// Chart: each finished interval's average and p95 ping, and its
// interruptions and disconnects as bars.
const chartEl = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | undefined;
function draw() {
  const el = chartEl.value;
  // Hidden (no history yet, or the tab not shown): drawing now would size
  // the chart to nothing. The size watch below draws once it has room.
  if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
  chart ??= echarts.init(el, theme.current.value.dark ? "dark" : undefined, { renderer: "canvas" });
  const rows = history.value;
  chart.setOption(
    {
      backgroundColor: "transparent",
      animation: false,
      grid: { left: 48, right: 40, top: 36, bottom: 28 },
      legend: { top: 0, orient: "horizontal", itemWidth: 14, itemHeight: 8, textStyle: { fontSize: 11 } },
      tooltip: { trigger: "axis" },
      xAxis: { type: "time" },
      yAxis: [
        { type: "value", name: "ms", nameTextStyle: { fontSize: 10 }, splitLine: { lineStyle: { opacity: 0.15 } } },
        { type: "value", minInterval: 1, splitLine: { show: false } },
      ],
      series: [
        { name: t("$vuetify.adminStats.avg"), type: "line", showSymbol: false, data: rows.map((r) => [r.ended_at, r.latency?.avg_ms ?? null]) },
        { name: "p95", type: "line", showSymbol: false, lineStyle: { type: "dashed" }, data: rows.map((r) => [r.ended_at, r.latency?.p95_ms ?? null]) },
        { name: t("$vuetify.adminStats.interruptions"), type: "bar", yAxisIndex: 1, barMaxWidth: 6, itemStyle: { color: "#fb8c00" }, data: rows.map((r) => [r.ended_at, r.interruptions ?? 0]) },
        { name: t("$vuetify.adminStats.disconnects"), type: "bar", yAxisIndex: 1, barMaxWidth: 6, itemStyle: { color: "#e53935" }, data: rows.map((r) => [r.ended_at, r.disconnects ?? 0]) },
      ],
    },
    true,
  );
}
watch(history, () => nextTick(draw));
// Follows its box: shown, dialog opened, window resized.
let sizeWatch: ResizeObserver | undefined;
onMounted(() => {
  sizeWatch = new ResizeObserver(() => {
    if (chart) chart.resize();
    else draw();
  });
  if (chartEl.value) sizeWatch.observe(chartEl.value);
  draw();
});
onUnmounted(() => {
  sizeWatch?.disconnect();
  chart?.dispose();
});
</script>

<template>
  <div class="admin-stats">
    <v-alert
      v-if="live && !live.enabled"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-3"
      :text="t('$vuetify.adminStats.off')"
    />

    <div class="text-subtitle-2 mb-2">{{ t("$vuetify.adminStats.live") }}</div>
    <div v-if="!sessions.length" class="text-caption text-medium-emphasis mb-3">
      {{ t("$vuetify.adminStats.noSession") }}
    </div>
    <div v-for="row in sessions" :key="row.session?.id" class="admin-stats__session mb-3">
      <div class="d-flex align-center flex-wrap ga-2 mb-2">
        <v-chip size="small" variant="tonal" color="success" prepend-icon="mdi-record-circle-outline">
          {{ profileName(row.session?.profile_id ?? "") }}
        </v-chip>
        <span class="text-caption text-medium-emphasis">
          {{ time(row.session?.started_at ?? 0) }} · {{ duration(row.session?.started_at ?? Date.now()) }}
        </span>
        <v-spacer />
        <span class="text-caption text-medium-emphasis">{{ row.session?.capture_mode }}</span>
      </div>
      <div class="admin-stats__grid">
        <div><span>{{ t("$vuetify.adminStats.ping") }}</span><b>{{ formatMs(row.session?.latency?.avg_ms) }}</b></div>
        <div><span>p95</span><b>{{ formatMs(row.session?.latency?.p95_ms) }}</b></div>
        <div><span>{{ t("$vuetify.adminStats.jitter") }}</span><b>{{ formatMs(row.session?.latency?.jitter_ms, "—", 1) }}</b></div>
        <div><span>{{ t("$vuetify.adminStats.loss") }}</span><b>{{ localDigits(loss(row.session?.latency).toFixed(1)) }}%</b></div>
        <div><span>{{ t("$vuetify.adminStats.connections") }}</span><b>{{ localDigits(row.session?.connections ?? 0) }}</b></div>
        <div><span>↓ / ↑</span><b>{{ formatSize(row.session?.bytes_down ?? 0) }} / {{ formatSize(row.session?.bytes_up ?? 0) }}</b></div>
        <div><span>{{ t("$vuetify.adminStats.interruptions") }}</span><b>{{ localDigits(row.session?.interruptions ?? 0) }}</b></div>
        <div><span>{{ t("$vuetify.adminStats.disconnects") }}</span><b>{{ localDigits(row.session?.disconnects ?? 0) }}</b></div>
        <div><span>{{ t("$vuetify.adminStats.failovers") }}</span><b>{{ localDigits(row.session?.failovers ?? 0) }}</b></div>
        <div><span>{{ t("$vuetify.adminStats.redials") }}</span><b>{{ localDigits(row.session?.path_redials ?? 0) }}</b></div>
        <div><span>{{ t("$vuetify.adminStats.relays") }}</span><b>{{ localDigits(row.session?.relay_node_ids?.length ?? 0) }}</b></div>
        <div><span>{{ t("$vuetify.adminStats.adapters") }}</span><b>{{ localDigits(row.session?.adapter_count ?? 0) }}</b></div>
      </div>
      <div v-if="row.interval" class="admin-stats__interval">
        <span class="text-medium-emphasis">{{ t("$vuetify.adminStats.interval", duration(row.interval.started_at)) }}</span>
        <span>{{ formatMs(row.interval.latency?.avg_ms) }}</span>
        <span>{{ t("$vuetify.adminStats.routeChanges") }} {{ localDigits(row.interval.route_changes ?? 0) }}</span>
        <span>{{ t("$vuetify.adminStats.interruptions") }} {{ localDigits(row.interval.interruptions ?? 0) }}</span>
        <span>{{ t("$vuetify.adminStats.disconnects") }} {{ localDigits(row.interval.disconnects ?? 0) }}</span>
        <span>{{ t("$vuetify.adminStats.lagFixes") }} {{ localDigits(row.interval.lag_fixes_ok ?? 0) }}/{{ localDigits(row.interval.lag_fixes ?? 0) }}</span>
      </div>
    </div>

    <div class="text-subtitle-2 mb-1 mt-4">{{ t("$vuetify.adminStats.history") }}</div>
    <div v-show="history.length" ref="chartEl" class="admin-stats__chart" />
    <div v-if="!history.length" class="text-caption text-medium-emphasis mb-3">
      {{ t("$vuetify.adminStats.noHistory") }}
    </div>
    <v-table v-if="history.length" density="compact" class="admin-stats__table">
      <thead>
        <tr>
          <th>{{ t("$vuetify.adminStats.ended") }}</th>
          <th v-if="kind === 'title'">{{ t("$vuetify.adminStats.profile") }}</th>
          <th>{{ t("$vuetify.adminStats.ping") }}</th>
          <th>p95</th>
          <th>{{ t("$vuetify.adminStats.loss") }}</th>
          <th>{{ t("$vuetify.adminStats.routeChanges") }}</th>
          <th>{{ t("$vuetify.adminStats.interruptions") }}</th>
          <th>{{ t("$vuetify.adminStats.disconnects") }}</th>
          <th>{{ t("$vuetify.adminStats.lagFixes") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in [...history].reverse().slice(0, 50)" :key="row.id">
          <td>{{ time(row.ended_at) }}</td>
          <td v-if="kind === 'title'">{{ profileName(row.profile_id) }}</td>
          <td>{{ formatMs(row.latency?.avg_ms) }}</td>
          <td>{{ formatMs(row.latency?.p95_ms) }}</td>
          <td>{{ localDigits(loss(row.latency).toFixed(1)) }}%</td>
          <td>{{ localDigits(row.route_changes ?? 0) }}</td>
          <td :class="{ 'text-warning': (row.interruptions ?? 0) > 0 }">{{ localDigits(row.interruptions ?? 0) }}</td>
          <td :class="{ 'text-error': (row.disconnects ?? 0) > 0 }">{{ localDigits(row.disconnects ?? 0) }}</td>
          <td>{{ localDigits(row.lag_fixes_ok ?? 0) }}/{{ localDigits(row.lag_fixes ?? 0) }}</td>
        </tr>
      </tbody>
    </v-table>
  </div>
</template>

<style scoped>
.admin-stats__session {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.admin-stats__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 8px 16px;
}

.admin-stats__grid > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.admin-stats__grid span {
  font-size: 0.68rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.admin-stats__grid b {
  font-size: 0.85rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.admin-stats__interval {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}

.admin-stats__chart {
  height: 220px;
  width: 100%;
}

.admin-stats__table {
  background: transparent;
  font-variant-numeric: tabular-nums;
}
</style>
