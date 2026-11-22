<script setup lang="ts">
import FlagImg from "~/components/common/FlagImg.vue";
import { useNow } from "@vueuse/core";
import { useLocale } from "vuetify";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import type { DiagramRoute } from "~/bindings/github.com/lagzap/lagzap/adapter";
import { useStore } from "@/stores";
import { useProfileChart } from "~/composables/useProfileChart";
import { useNodeLocationLabel } from "~/composables/useNodeLocationLabel";
import { BEST_INTERFACE, useProfileViewInterface } from "~/composables/useProfileViewInterface";
import { useProfileWireGuard } from "~/composables/useProfileWireGuard";
import { getLatencyColorClass } from "~/composables/useLatencyMetrics";
import { countryName, formatMs, localDigits } from "~/utils/localeFormat";
import TitleIcon from "~/components/title/TitleIcon.vue";

/* The profile's route diagram, one element in two sizes. Folded: the route
 * in use, You → servers → the game. Expanded (Details): every route the
 * profile has, one row each, joined to You and the game by curves. Every
 * server, leg, route and the game tell more on hover. */
const props = defineProps<{
  profile: Profile;
  gameName?: string;
  gameIcon?: string | null;
  expanded?: boolean;
  /** No loss and bursts under the diagram: the card shows them itself. */
  hideLink?: boolean;
  /** Simple view: a click on the diagram folds or expands it. */
  toggleable?: boolean;
}>();
const emit = defineEmits<{ toggle: [] }>();

const { t } = useLocale();
const store = useStore();
const { chart } = useProfileChart(props.profile.id);
const { selectedInterfaceKey } = useProfileViewInterface(props.profile.id);
const { getNodeLabelByIp } = useNodeLocationLabel();
const wireGuard = useProfileWireGuard(props.profile.id);

const diagram = computed(() => (chart.value?.diagram?.show ? chart.value.diagram : null));
/** The internet picked under "Show routes on", else all of them (best). */
const view = computed(() => {
  const d = diagram.value;
  if (!d) return null;
  if (selectedInterfaceKey.value === BEST_INTERFACE) return d.best;
  const want = selectedInterfaceKey.value.trim().toLowerCase();
  return (d.interfaces.find((i) => i.name.trim().toLowerCase() === want) ?? d.interfaces[0])?.view ?? null;
});
const preview = computed(() => (view.value?.routes?.length ? null : diagram.value?.preview ?? null));
const estimate = computed(() => !!preview.value || !!diagram.value?.idle);

type Stop = { label: string; country: string; ms: number; ip: string };
type Row = {
  key: string;
  iface: string;
  stops: Stop[];
  transport: string;
  planned: boolean;
  best: boolean;
  route: DiagramRoute | null;
};

function ipVersion(ip?: string | null) {
  return ip?.includes(":") ? "v6" : "v4";
}

function stopsOf(route: DiagramRoute): Stop[] {
  return (route.hops ?? []).map((hop, i) => {
    const node = hop.node_id ? store.nodes[hop.node_id] : undefined;
    return {
      label: getNodeLabelByIp(hop.ip) || (node ? String(store.localized(node.city) || node.name) : "?"),
      country: node?.country ?? "",
      // The first leg can be direct (0); a server-to-server leg never is.
      ms: i === 0 ? (hop.latency >= 0 ? hop.latency : -1) : hop.latency > 0 ? hop.latency : -1,
      ip: hop.ip ?? "",
    };
  });
}

/** The best route first, then the others in order; a preview's shape when
 * there is no route yet. */
const rows = computed<Row[]>(() => {
  const routes = view.value?.routes ?? [];
  if (routes.length) {
    const best = view.value?.estimate?.best ?? -1;
    const list = routes.map((route, i) => {
      const last = route.hops?.[route.hops.length - 1];
      return {
        key: route.path_key || String(i),
        iface: route.iface,
        stops: stopsOf(route),
        transport: `${route.network === "tcp" ? "TCP" : "UDP"} ${ipVersion(last?.ip)}`,
        planned: !!route.planned,
        best: i === best,
        route,
      };
    });
    const i = list.findIndex((r) => r.best);
    if (i > 0) list.unshift(...list.splice(i, 1));
    return list;
  }
  const p = preview.value;
  if (!p) return [];
  const node = p.relay_node_id ? store.nodes[p.relay_node_id] : undefined;
  const city = node ? String(store.localized(node.city) || node.name) : "";
  const exit: Stop = {
    label: p.direct
      ? t("$vuetify.title.profile.server.directWithoutServer")
      : city
        ? p.cities > 1 ? `${city} 1+${p.cities - 1}` : city
        : t("$vuetify.title.profile.server.automaticServer"),
    country: node?.country ?? "",
    ms: -1,
    ip: "",
  };
  const domestic: Stop = { label: t("$vuetify.title.profile.domestic"), country: "", ms: -1, ip: "" };
  return (p.interfaces?.length ? p.interfaces : [""]).map((iface, i) => ({
    key: `preview-${i}`,
    iface,
    stops: p.domestic ? [domestic, exit] : [exit],
    transport: "",
    planned: true,
    best: i === 0,
    route: null,
  }));
});
/** The pointer is on a server: its own tooltip shows, not the route's. */
const overStop = ref(false);
/** The routes carrying the game (planned ones not counted). */
const liveCount = computed(() => rows.value.filter((r) => r.route && !r.planned).length);
const shown = computed(() => (props.expanded ? rows.value : rows.value.slice(0, 1)));

/* The curves from You to each row and from each row to the game. */
const ROW_H_FOLDED = 36;
const ROW_H_OPEN = 50;
const ROW_H_REF = computed(() => (props.expanded ? ROW_H_OPEN : ROW_H_FOLDED));
/** Expanded rows keep room under the line for captions: the line sits
 * this much above the row's middle. */
const CAPTION_PAD = 12;
// Exactly where each row's 1px line is centred, so the brackets meet it.
const lineY = (i: number) =>
  i * ROW_H_REF.value + (ROW_H_REF.value - (props.expanded ? CAPTION_PAD : 0)) / 2;
const JOIN_W = 22;
const boxHeight = computed(() => Math.max(1, shown.value.length) * ROW_H_REF.value);
/** A bracket from You (or the game) to each row: one shared line meets a
 * trunk square on, then a rounded corner turns into the row. Every path starts
 * at You (or the game), so where they overlap their dashes line up. */
function joinPath(i: number, side: "in" | "out") {
  const n = shown.value.length;
  const mid = (lineY(0) + lineY(n - 1)) / 2;
  const y = lineY(i);
  const trunk = side === "in" ? 10 : JOIN_W - 10;
  const start = side === "in" ? 0 : JOIN_W;
  const end = side === "in" ? JOIN_W : 0;
  const dir = side === "in" ? 1 : -1;
  const gap = Math.abs(y - mid);
  if (gap < 1) return `M${start} ${mid} H${end}`;
  const r = Math.min(6, gap / 2);
  const s = y > mid ? 1 : -1;
  return (
    `M${start} ${mid} H${trunk} V${y - s * r} Q${trunk} ${y} ${trunk + dir * r} ${y} H${end}`
  );
}

function msClass(ms: number) {
  if (ms <= 0) return "";
  const name = getLatencyColorClass(ms);
  return name === "grey" ? "text-grey" : `text-${name}`;
}
/** "93ms", kept in that order inside right-to-left text. */
function ms(v: number) {
  return formatMs(v);
}

/** Dedicated IP in use: its server between the last relay and the game. */
const dedicated = computed(() => {
  if (!wireGuard.active.value || !wireGuard.selected.value) return null;
  const s = wireGuard.selected.value;
  const status = wireGuard.status.value;
  return {
    label: s.city || s.country || "WireGuard",
    country: s.country ?? "",
    ping: status.state === "working" && status.ping ? status.ping : 0,
  };
});

const session = computed(() => {
  const s = diagram.value?.session;
  if (!s?.network) return null;
  return s;
});
const now = useNow({ interval: 1000 });
function elapsed(start: number) {
  const total = Math.max(0, Math.floor((now.value.getTime() - start) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return localDigits(h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`);
}

/** Loss and bursts of the game's own connection, while there are any. */
const link = computed(() => {
  if (estimate.value) return null;
  const loss = chart.value?.link?.loss ?? 0;
  const burst = chart.value?.link?.burst ?? 0;
  if (loss <= 0 && burst <= 0) return null;
  const pct = (v: number) => localDigits(`${v < 10 ? v.toFixed(1) : Math.round(v)}%`);
  return { loss: loss > 0 ? pct(loss) : "", burst: burst > 0 ? pct(burst) : "", lossBad: loss >= 5, burstBad: burst >= 20 };
});

</script>

<template>
  <div
    v-if="rows.length"
    class="rl"
    :class="{ 'rl--estimate': estimate, 'rl--toggle': toggleable, 'rl--open': expanded }"
    :role="toggleable ? 'button' : undefined"
    :tabindex="toggleable ? 0 : undefined"
    :aria-expanded="toggleable ? !!expanded : undefined"
    @click="toggleable && emit('toggle')"
    @keydown.enter.space.prevent="toggleable && emit('toggle')"
  >
    <div class="rl__map">
      <span class="rl__pill rl__pill--you">{{ t("$vuetify.title.profile.routeYou") }}</span>

      <svg v-if="shown.length > 1" class="rl__join" :width="JOIN_W" :height="boxHeight" aria-hidden="true">
        <path v-for="(row, i) in shown" :key="row.key" :d="joinPath(i, 'in')" :class="{ 'rl__curve--planned': row.planned }" />
      </svg>
      <span v-else class="rl__leg rl__leg--join" />

      <div class="rl__rows" :style="{ height: `${boxHeight}px` }">
        <v-tooltip
          v-for="row in shown"
          :key="row.key"
          location="top"
          open-delay="300"
          :disabled="!row.route || overStop"
        >
          <template #activator="{ props: tip }">
            <div
              v-bind="tip"
              class="rl__row"
              :class="{ 'rl__row--other': !row.best, 'rl__row--planned': row.planned }"
            >
              <template v-for="(stop, i) in row.stops" :key="i">
                <span class="rl__leg">
                  <b v-if="stop.ms > 0">{{ ms(stop.ms) }}</b>
                  <b v-else-if="stop.ms === 0">{{ t("$vuetify.networkLatency.directHop") }}</b>
                  <small v-if="expanded && i === 0 && row.iface">{{ row.iface }}</small>
                </span>
                <v-tooltip location="bottom" open-delay="200" :disabled="!stop.ip">
                  <template #activator="{ props: stopTip }">
                    <span
                      v-bind="stopTip"
                      class="rl__pill"
                      @mouseenter="overStop = true"
                      @mouseleave="overStop = false"
                    >
                      <FlagImg v-if="stop.country" :country="stop.country" :height="12" />
                      <span class="rl__name">{{ stop.label }}</span>
                      <small v-if="expanded && row.transport" class="rl__under">{{ row.transport }}</small>
                    </span>
                  </template>
                  <table class="rl__tip">
                    <tr><td>{{ t("$vuetify.networkLatency.city") }}</td><td>{{ stop.label }}</td></tr>
                    <tr v-if="stop.country"><td>{{ t("$vuetify.networkLatency.country") }}</td><td>{{ countryName(stop.country) }}</td></tr>
                    <tr v-if="row.route && row.route.latency > 0">
                      <td>{{ t("$vuetify.title.profile.estimatedPing") }}</td>
                      <td :class="msClass(row.route.latency)">{{ ms(row.route.latency) }}</td>
                    </tr>
                    <tr v-if="row.route && row.route.score > 0"><td>{{ t("$vuetify.networkLatency.sessionScore") }}</td><td>{{ localDigits(row.route.score) }}</td></tr>
                  </table>
                </v-tooltip>
              </template>
              <span class="rl__leg rl__leg--out">
                <template v-if="expanded && row.route">
                  <b class="rl__sum" :class="msClass(row.route.latency)">
                    {{ row.route.latency > 0 ? ms(row.route.latency) : "—" }}
                  </b>
                  <small v-if="row.route.packet_loss > 0" class="text-warning">
                    {{ t("$vuetify.title.profile.estimateLoss", localDigits(Math.round(row.route.packet_loss))) }}
                  </small>
                  <small v-else-if="row.best && rows.length > 1" class="rl__best">{{ t("$vuetify.title.routeMap.best") }}</small>
                </template>
                <!-- Folded: how many routes carry it (the protocol is in the
                     expanded view, under each server). -->
                <i v-else-if="liveCount > 1" class="rl__chip">
                  {{ t("$vuetify.title.profile.subtitleRoutes", localDigits(liveCount)) }}
                </i>
              </span>
            </div>
          </template>
          <!-- The route: its ping and spread, loss, score. -->
          <table v-if="row.route" class="rl__tip">
            <tr><td>{{ t("$vuetify.title.profile.estimatedPing") }}</td><td :class="msClass(row.route.latency)">{{ row.route.latency > 0 ? ms(row.route.latency) : "—" }}</td></tr>
            <tr v-if="row.route.avg > 0"><td>Avg</td><td>{{ ms(row.route.avg) }}</td></tr>
            <tr v-if="row.route.min > 0"><td>Min</td><td>{{ ms(row.route.min) }}</td></tr>
            <tr v-if="row.route.max > 0"><td>Max</td><td>{{ ms(row.route.max) }}</td></tr>
            <tr v-if="row.route.packet_loss > 0">
              <td>{{ t("$vuetify.networkLatency.loss") }}</td>
              <td :class="row.route.packet_loss >= 8 ? 'text-error' : ''">{{ localDigits(`${Math.round(row.route.packet_loss)}%`) }}</td>
            </tr>
            <tr v-if="row.route.score > 0"><td>{{ t("$vuetify.networkLatency.sessionScore") }}</td><td>{{ localDigits(row.route.score) }}</td></tr>
            <tr v-if="row.iface"><td>{{ t("$vuetify.networkLatency.sessionInternets") }}</td><td>{{ row.iface }}</td></tr>
            <tr v-if="row.planned"><td>{{ t("$vuetify.networkLatency.plannedRoute") }}</td><td>{{ t("$vuetify.networkLatency.plannedRouteHint") }}</td></tr>
          </table>
        </v-tooltip>
      </div>

      <svg v-if="shown.length > 1" class="rl__join" :width="JOIN_W" :height="boxHeight" aria-hidden="true">
        <path v-for="(row, i) in shown" :key="row.key" :d="joinPath(i, 'out')" :class="{ 'rl__curve--planned': row.planned }" />
      </svg>
      <span v-else class="rl__leg rl__leg--join" />

      <!-- Dedicated IP: its server takes the traffic on to the game. -->
      <template v-if="dedicated">
        <span class="rl__pill">
          <FlagImg v-if="dedicated.country" :country="dedicated.country" :height="12" />
          <span class="rl__name">{{ dedicated.label }}</span>
        </span>
        <span class="rl__leg rl__leg--short">
          <b v-if="dedicated.ping" :class="msClass(dedicated.ping)">{{ ms(dedicated.ping) }}</b>
          <small>WireGuard</small>
        </span>
      </template>

      <!-- The game; the live session on hover. -->
      <v-tooltip location="bottom end" open-delay="200" :disabled="!session">
        <template #activator="{ props: gameTip }">
          <span v-bind="gameTip" class="rl__pill rl__pill--game">
            <TitleIcon v-if="gameIcon" :image="gameIcon" :size="16" rounded="circle" />
            <span class="rl__name">{{ gameName }}</span>
          </span>
        </template>
        <table v-if="session" class="rl__tip">
          <tr v-if="session.ping > 0"><td>{{ t("$vuetify.networkLatency.sessionPing") }}</td><td :class="msClass(session.ping)">{{ ms(session.ping) }}</td></tr>
          <tr v-if="session.score > 0"><td>{{ t("$vuetify.networkLatency.sessionScore") }}</td><td>{{ localDigits(session.score) }}</td></tr>
          <tr v-if="session.internets?.length"><td>{{ t("$vuetify.networkLatency.sessionInternets") }}</td><td>{{ session.internets.join(", ") }}</td></tr>
          <tr><td>{{ t("$vuetify.networkLatency.sessionConnections") }}</td><td>{{ localDigits(session.connections) }}</td></tr>
          <tr v-if="session.started_at > 0"><td>{{ t("$vuetify.networkLatency.sessionTime") }}</td><td>{{ elapsed(session.started_at) }}</td></tr>
          <tr v-if="session.server"><td>{{ t("$vuetify.networkLatency.gameServer") }}</td><td dir="ltr">{{ session.server }}</td></tr>
        </table>
      </v-tooltip>
    </div>

    <!-- The game's loss and bursts, while there are any. -->
    <div v-if="link && !hideLink" class="rl__foot">
      <span class="rl__link">
        <span v-if="link.loss" :class="link.lossBad ? 'text-error' : 'text-warning'">
          {{ t("$vuetify.networkLatency.loss") }} {{ link.loss }}
        </span>
        <span v-if="link.loss">{{ t("$vuetify.networkLatency.lossRecovered") }}</span>
        <span v-if="link.burst" :class="link.burstBad ? 'text-error' : 'text-warning'">
          <v-icon icon="mdi-pulse" size="12" /> {{ t("$vuetify.networkLatency.burst") }} {{ link.burst }}
        </span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.rl {
  --rl-line: rgba(var(--v-theme-on-surface), 0.3);
  --rl-bg: rgb(var(--v-theme-surface));
  font-size: 0.75rem;
}

.v-theme--light .rl {
  --rl-bg: rgb(var(--v-theme-surface));
}

.rl--toggle {
  cursor: pointer;
  border-radius: 8px;
  margin-inline: -8px;
  padding: 2px 8px;
  transition: background-color 0.15s ease;
}

/* Expanded: the rows' lines sit above their middles (captions under
 * them), so You, the game and Dedicated IP sit on the joined line. */
.rl--open .rl__map > .rl__pill,
.rl--open .rl__map > .rl__leg,
.rl--open .rl__map > .v-tooltip-activator {
  transform: translateY(-6px);
}

/* Expanded: more room above and below the routes. */
.rl.rl--open {
  padding-top: 20px;
  padding-bottom: 20px;
}

.rl--open .rl__row {
  flex-basis: 50px;
  padding-bottom: 12px;
}

.rl--toggle:focus-visible {
  outline: 1px solid rgba(var(--v-theme-primary), 0.6);
}

.rl__total {
  flex-shrink: 0;
  display: inline-flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 48px;
  line-height: 1.2;
}

.rl__total b {
  font-weight: 500;
}

.rl__total small {
  font-size: 0.625rem;
}

.rl__map {
  display: flex;
  align-items: center;
  min-width: 0;
}

.rl__rows {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: height 0.2s ease;
}

.rl__row {
  display: flex;
  align-items: center;
  flex: 0 0 36px;
  padding-bottom: 0;
  gap: 6px;
  min-width: 0;
}

.rl__row--other {
  opacity: 0.7;
}

.rl__row--planned {
  opacity: 0.45;
}

.rl__join {
  flex-shrink: 0;
  overflow: visible;
}

/* The curves are drawn left to right: mirror them when the page is. */
.v-locale--is-rtl .rl__join {
  transform: scaleX(-1);
}

.rl__join path {
  fill: none;
  stroke: var(--rl-line);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}

.rl__join path.rl__curve--planned {
  stroke-dasharray: 1 4;
}

.rl__pill {
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 160px;
  padding: 3px 10px;
  border-radius: 999px;
  white-space: nowrap;
  background: rgba(var(--v-theme-on-surface), 0.08);
}

.rl__pill--you {
  background: rgba(var(--v-theme-primary), 0.15);
  color: rgb(var(--v-theme-primary));
}

.rl__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* A leg: a 1px line dashed 4 on, 4 off, like the curves. */
.rl__leg {
  position: relative;
  flex: 1;
  align-self: center;
  min-width: 26px;
  height: 1px;
  background: repeating-linear-gradient(to right, var(--rl-line) 0 4px, transparent 4px 8px);
}

.rl__row--planned .rl__leg {
  background: repeating-linear-gradient(to right, var(--rl-line) 0 1px, transparent 1px 5px);
}

.rl__leg--join {
  flex: 0 0 22px;
  min-width: 22px;
}

.rl__leg--short {
  flex: 0 0 64px;
}

.rl__leg b.rl__sum {
  font-weight: 600;
}

.rl__leg b,
.rl__chip {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  background: var(--rl-bg);
}

.rl__leg b {
  top: -8px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  padding: 0 4px;
  font-size: 0.6875rem;
  font-weight: 500;
}

.rl__leg small {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.625rem;
  white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.rl__under {
  position: absolute;
  top: calc(100% + 2px);
  left: 50%;
  transform: translateX(-50%);
  font-size: 0.5625rem;
  white-space: nowrap;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.rl__best {
  color: rgb(var(--v-theme-primary)) !important;
}

.rl__chip {
  top: -7px;
  padding: 0 4px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.25);
  border-radius: 4px;
  font-size: 0.625rem;
  font-style: normal;
  line-height: 14px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.rl__foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  margin-top: 4px;
  font-size: 0.6875rem;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

.rl__link {
  display: inline-flex;
  gap: 8px;
}

.rl__tip td {
  padding: 2px 0;
  font-size: 0.75rem;
  white-space: nowrap;
}

.rl__tip td:first-child {
  padding-inline-end: 14px;
  opacity: 0.6;
}

.rl__tip td:last-child {
  text-align: end;
}
</style>
