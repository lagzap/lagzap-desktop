<script setup lang="ts">
import { useProfileRouteCounts } from "~/composables/useProfileRouteCounts";
import { MAX_ROUTES } from "~/composables/routeCountUtils";
import FlagImg from "~/components/common/FlagImg.vue";
import { useNow, useResizeObserver } from "@vueuse/core";
import { useLocale } from "vuetify";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import type { DiagramRoute, LegQuality } from "~/bindings/github.com/lagzap/lagzap/adapter";
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
  /** The title's main card: exactly the routes Route Settings sets (its
   * TCP and UDP counts), one row each; a route not up yet shows as being
   * found. */
  exact?: boolean;
}>();
const emit = defineEmits<{ toggle: [] }>();

const { t } = useLocale();
const store = useStore();
const { chart } = useProfileChart(props.profile.id);
const { selectedInterfaceKey } = useProfileViewInterface(props.profile.id);
const { getNodeLabelByIp } = useNodeLocationLabel();
const wireGuard = useProfileWireGuard(props.profile.id);
/** The routes it is set to use (Route Settings' TCP and UDP), whatever is
 * up right now: the count the chip shows, and the rows when exact. */
const { resolvedCounts } = useProfileRouteCounts(() => props.profile.id);
const routesSet = computed(() => resolvedCounts.value.total);

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

/** A session's own legs are drawn as they are: each internet runs its own
 * routes, so there can be more legs than the count set, or fewer (a leg
 * waits rather than double another's path). Routes that are not up only
 * fill what is left up to that count; capRows keeps the whole to
 * MAX_ROUTES. */
function liveFirst(of: Row[], want: number): Row[] {
  const live = of.filter((r) => r.route && !r.planned);
  const rest = of.filter((r) => !r.route || r.planned);
  return [...live, ...rest.slice(0, Math.max(0, want - live.length))];
}

/** Exact: every live leg (best first), then as many TCP and UDP rows as
 * set, a "finding a route" row for each one not up. */
function exactRows(list: Row[]): Row[] {
  // Smart: one total, the split is LagZap's; the routes up to it.
  if (resolvedCounts.value.unified) {
    if (!estimate.value) return liveFirst(list, resolvedCounts.value.total);
    const capped = list.slice(0, resolvedCounts.value.total);
    capped.sort((a, b) => a.key.localeCompare(b.key));
    return capped;
  }
  const want = { TCP: resolvedCounts.value.tcp, UDP: resolvedCounts.value.udp };
  const out: Row[] = [];
  // No session (a preview): the routes it would use, up to the counts set,
  // in a steady order (by path, not by the estimate that keeps moving);
  // nothing is being found, so no placeholder rows.
  const preview = estimate.value;
  for (const net of ["UDP", "TCP"] as const) {
    const of = list.filter((r) => r.transport.startsWith(net));
    if (preview) of.sort((a, b) => a.key.localeCompare(b.key));
    const have = preview ? of.slice(0, want[net]) : liveFirst(of, want[net]);
    out.push(...have);
    if (preview) continue;
    for (let i = have.length; i < want[net]; i++) {
      out.push({
        key: `finding-${net}-${i}`,
        iface: "",
        stops: [{ label: t("$vuetify.title.playFrom.findingRoute"), country: "", ms: -1, ip: "" }],
        transport: net,
        planned: true,
        best: false,
        route: null,
      });
    }
  }
  if (!preview) {
    const b = out.findIndex((r) => r.best);
    if (b > 0) out.unshift(...out.splice(b, 1));
  }
  return out;
}

/** The diagram never draws more than MAX_ROUTES routes. A session has one
 * more for a moment whenever a leg is replaced (the new one comes up beside
 * the old one before it closes): the legs that deliver stay, then the ones
 * that are up but have delivered nothing yet, then the ones being found. */
function capRows(list: Row[]): Row[] {
  if (list.length <= MAX_ROUTES) return list;
  const up = list.filter((r) => r.route && !r.planned);
  const delivering = up.filter((r) => (legs.value.get(r.key)?.received ?? 0) > 0);
  const quiet = up.filter((r) => !delivering.includes(r));
  const rest = list.filter((r) => !r.route || r.planned);
  return [...delivering, ...quiet, ...rest].slice(0, MAX_ROUTES);
}

/** The best route first, then the others in order; a preview's shape when
 * there is no route yet. */
const rows = computed<Row[]>(() => capRows(props.exact ? exactRows(allRows.value) : allRows.value));
const allRows = computed<Row[]>(() => {
  const routes = view.value?.routes ?? [];
  if (routes.length) {
    const best = view.value?.estimate?.best ?? -1;
    const list = routes.map((route, i) => {
      const last = route.hops?.[route.hops.length - 1];
      return {
        // A leg is its internet, transport and servers together: two legs
        // through the same servers (another internet, or UDP beside TCP)
        // are two rows. Keyed by the servers alone they shared a key, and
        // the list kept rows of legs that were long gone.
        key: `${route.iface}|${route.network}|${route.path_key || i}`,
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

/** What each leg of the live session really does, from the session's own
 * counts over the last seconds, keyed like the rows. */
const legs = computed(() => {
  const out = new Map<string, LegQuality>();
  if (estimate.value) return out;
  for (const leg of chart.value?.link?.legs ?? []) {
    if (!leg.backup) out.set(`${leg.iface}|${leg.network}|${leg.path_key}`, leg);
  }
  return out;
});
function legOf(row: Row): LegQuality | null {
  return row.route && !row.planned ? legs.value.get(row.key) ?? null : null;
}
const share = (v: number) => localDigits(`${v > 0 && v < 10 ? v.toFixed(1) : Math.round(v)}%`);
/** Under a leg's line: its loss while it is losing, else how much of the
 * traffic it delivers before every other leg (the leg with the most is the
 * one carrying the game). */
function legNote(row: Row): { text: string; cls: string } | null {
  const leg = legOf(row);
  if (!leg || (!leg.received && !leg.loss)) return null;
  if (leg.loss >= 5) {
    return {
      text: t("$vuetify.title.profile.estimateLoss", localDigits(Math.round(leg.loss))),
      cls: leg.loss >= 50 ? "text-error" : "text-warning",
    };
  }
  return { text: `${t("$vuetify.title.profile.link.colFirst")} ${share(leg.first)}`, cls: leg.first >= 50 ? "rl__best" : "" };
}

const shown = computed(() => (props.expanded ? rows.value : rows.value.slice(0, 1)));
/** Every route ends at the same relay: it shows once, where the routes
 * meet, instead of at the end of each row. */
const sharedExit = computed<Stop | null>(() => {
  if (!props.expanded || shown.value.length < 2) return null;
  // The routes up decide it; one still being found joins them there too.
  const ends = shown.value.filter((r) => r.route).map((r) => r.stops[r.stops.length - 1]!);
  if (!ends.length) return null;
  const key = (e: Stop) => e.ip || `${e.country}|${e.label}`;
  return ends.every((e) => key(e) === key(ends[0]!)) ? ends[0]! : null;
});
/** A row's stops before the shared relay (all of them without one, or
 * while it is still being found). */
const rowStops = (row: Row) => (sharedExit.value && row.route ? row.stops.slice(0, -1) : row.stops);
/** The best route's leg from the shared relay to the game. */
const sharedBest = computed(() => shown.value.find((r) => r.best)?.route ?? shown.value[0]?.route ?? null);

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
/** One bracket from You (or the game) to every row, drawn once: the line
 * from You to a trunk, the trunk from the top row to the bottom one with a
 * rounded corner at each end, and a straight branch into each row between.
 * Nothing is stroked twice, so the lines stay thin and meet exactly. */
/** The page puts the diagram at a fractional pixel; the rows' 1px lines
 * snap to whole pixels, so the bracket moves by the same amount to land on
 * those very pixels (else it smears over two and looks a hair off). */
const rootEl = ref<HTMLElement | null>(null);
const pixelAdj = ref(0);
/** The same sideways for each bracket's trunk: its 1px line on one pixel. */
const trunkAdj = ref({ in: 0, out: 0 });
function measurePixels() {
  const leg = rootEl.value?.querySelector(".rl__row .rl__leg");
  if (!leg) return;
  const top = leg.getBoundingClientRect().top;
  pixelAdj.value = Math.round(top) - top;
  const joins = rootEl.value?.querySelectorAll(".rl__join") ?? [];
  const adj = (el: Element | undefined, trunk: number) => {
    if (!el) return 0;
    const x = el.getBoundingClientRect().left + trunk;
    return Math.floor(x) + 0.5 - x;
  };
  trunkAdj.value = { in: adj(joins[0], 10), out: adj(joins[1], JOIN_W - 10) };
}
useResizeObserver(rootEl, () => measurePixels());
watch(shown, () => nextTick(measurePixels));
onMounted(() => nextTick(measurePixels));

function bracketPath(side: "in" | "out") {
  const n = shown.value.length;
  const at = (i: number) => lineY(i) + pixelAdj.value;
  const top = at(0);
  const bottom = at(n - 1);
  const mid = (top + bottom) / 2;
  const trunk = (side === "in" ? 10 : JOIN_W - 10) + trunkAdj.value[side];
  const start = side === "in" ? 0 : JOIN_W;
  const end = side === "in" ? JOIN_W : 0;
  const dir = side === "in" ? 1 : -1;
  const r = Math.min(6, (bottom - top) / 4);
  const parts = [`M${start} ${mid} H${trunk}`];
  // The trunk and its two corners, one stroke from the top row to the bottom.
  parts.push(
    `M${end} ${top} H${trunk + dir * r} Q${trunk} ${top} ${trunk} ${top + r}` +
      ` V${bottom - r} Q${trunk} ${bottom} ${trunk + dir * r} ${bottom} H${end}`,
  );
  for (let i = 1; i < n - 1; i++) parts.push(`M${trunk} ${at(i)} H${end}`);
  return parts.join(" ");
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
/** Under the relay: the live session's real ping (the round trip its own
 * traffic gets); the best route's estimate while nothing is connected. */
const exitPing = computed(() => {
  if (!estimate.value && session.value && session.value.ping > 0) return session.value.ping;
  return sharedBest.value?.latency ?? 0;
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
    ref="rootEl"
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
        <path :d="bracketPath('in')" />
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
              <template v-for="(stop, i) in rowStops(row)" :key="i">
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
                    <tbody>
                    <tr><td>{{ t("$vuetify.networkLatency.city") }}</td><td>{{ stop.label }}</td></tr>
                    <tr v-if="stop.country"><td>{{ t("$vuetify.networkLatency.country") }}</td><td>{{ countryName(stop.country) }}</td></tr>
                    <tr v-if="row.route && row.route.latency > 0">
                      <td>{{ t("$vuetify.title.profile.estimatedPing") }}</td>
                      <td :class="msClass(row.route.latency)">{{ ms(row.route.latency) }}</td>
                    </tr>
                    <tr v-if="row.route && row.route.score > 0"><td>{{ t("$vuetify.networkLatency.sessionScore") }}</td><td>{{ localDigits(row.route.score) }}</td></tr>
                    </tbody>
                  </table>
                </v-tooltip>
              </template>
              <!-- Shared relay, reached straight from You: a Direct chip, with
                   a leg on each side like any other stop. -->
              <span v-if="sharedExit && row.route && !rowStops(row).length" class="rl__leg">
                <small v-if="expanded && row.iface">{{ row.iface }}</small>
              </span>
              <span v-if="sharedExit && row.route && !rowStops(row).length" class="rl__pill">
                <v-icon icon="mdi-arrow-right-thin" size="14" />
                <span class="rl__name">{{ t("$vuetify.title.playFrom.direct") }}</span>
                <small v-if="row.transport" class="rl__under">{{ row.transport }}</small>
              </span>
              <!-- Shared relay: the leg into it, on the line. -->
              <span v-if="sharedExit && row.route" class="rl__leg rl__leg--out">
                <b v-if="row.stops[row.stops.length - 1]!.ms > 0">{{ ms(row.stops[row.stops.length - 1]!.ms) }}</b>
                <!-- What this leg really does right now. -->
                <small v-if="expanded && legNote(row)" :class="legNote(row)!.cls">{{ legNote(row)!.text }}</small>
              </span>
              <span v-else class="rl__leg rl__leg--out">
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
                <i v-else-if="!expanded && liveCount > 0 && routesSet > 1" class="rl__chip">
                  {{ t("$vuetify.title.profile.subtitleRoutes", localDigits(routesSet)) }}
                </i>
              </span>
            </div>
          </template>
          <!-- The route: its ping and spread, loss, score. -->
          <table v-if="row.route" class="rl__tip">
            <tbody>
            <tr><td>{{ t("$vuetify.title.profile.estimatedPing") }}</td><td :class="msClass(row.route.latency)">{{ row.route.latency > 0 ? ms(row.route.latency) : "—" }}</td></tr>
            <tr v-if="row.route.avg > 0"><td>Avg</td><td>{{ ms(row.route.avg) }}</td></tr>
            <tr v-if="row.route.min > 0"><td>Min</td><td>{{ ms(row.route.min) }}</td></tr>
            <tr v-if="row.route.max > 0"><td>Max</td><td>{{ ms(row.route.max) }}</td></tr>
            <tr v-if="row.route.packet_loss > 0">
              <td>{{ t("$vuetify.networkLatency.loss") }}</td>
              <td :class="row.route.packet_loss >= 8 ? 'text-error' : ''">{{ localDigits(`${Math.round(row.route.packet_loss)}%`) }}</td>
            </tr>
            <tr v-if="row.route.score > 0"><td>{{ t("$vuetify.networkLatency.sessionScore") }}</td><td>{{ localDigits(row.route.score) }}</td></tr>
            <!-- The live leg's own counts: delivered first, lost, behind the first copy. -->
            <template v-if="legOf(row)">
              <tr><td>{{ t("$vuetify.title.profile.link.colFirst") }}</td><td>{{ share(legOf(row)!.first) }}</td></tr>
              <tr v-if="legOf(row)!.loss > 0">
                <td>{{ t("$vuetify.title.profile.link.colLoss") }}</td>
                <td :class="legOf(row)!.loss >= 5 ? 'text-warning' : ''">{{ share(legOf(row)!.loss) }}</td>
              </tr>
              <tr v-if="legOf(row)!.lag > 0"><td>{{ t("$vuetify.title.profile.link.colLag") }}</td><td>{{ localDigits(legOf(row)!.lag) }}</td></tr>
            </template>
            <tr v-if="row.iface"><td>{{ t("$vuetify.networkLatency.sessionInternets") }}</td><td>{{ row.iface }}</td></tr>
            <tr v-if="row.planned"><td>{{ t("$vuetify.networkLatency.plannedRoute") }}</td><td>{{ t("$vuetify.networkLatency.plannedRouteHint") }}</td></tr>
            </tbody>
          </table>
        </v-tooltip>
      </div>

      <svg v-if="shown.length > 1" class="rl__join" :width="JOIN_W" :height="boxHeight" aria-hidden="true">
        <path :d="bracketPath('out')" />
      </svg>
      <span v-else class="rl__leg rl__leg--join" />

      <!-- The routes meet at the one relay they all end at. -->
      <!-- Its ping (the best route's) under it; the game right after. -->
      <template v-if="sharedExit">
        <span class="rl__pill rl__pill--exit">
          <FlagImg v-if="sharedExit.country" :country="sharedExit.country" :height="12" />
          <span class="rl__name">{{ sharedExit.label }}</span>
          <small v-if="exitPing > 0" class="rl__under rl__under--ping" :class="msClass(exitPing)">
            {{ ms(exitPing) }}
          </small>
        </span>
        <!-- On to the game: a plain short line. -->
        <span class="rl__leg rl__leg--tight" />
      </template>

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
          <!-- The game: its icon large, the name under it (long names wrap
               in less width). -->
          <span v-bind="gameTip" class="rl__game">
            <TitleIcon v-if="gameIcon" :image="gameIcon" :size="32" rounded="circle" />
            <span class="rl__game-name">{{ gameName }}</span>
          </span>
        </template>
        <table v-if="session" class="rl__tip">
          <tbody>
          <tr v-if="session.ping > 0"><td>{{ t("$vuetify.networkLatency.sessionPing") }}</td><td :class="msClass(session.ping)">{{ ms(session.ping) }}</td></tr>
          <tr v-if="session.score > 0"><td>{{ t("$vuetify.networkLatency.sessionScore") }}</td><td>{{ localDigits(session.score) }}</td></tr>
          <tr v-if="session.internets?.length"><td>{{ t("$vuetify.networkLatency.sessionInternets") }}</td><td>{{ session.internets.join(", ") }}</td></tr>
          <tr><td>{{ t("$vuetify.networkLatency.sessionConnections") }}</td><td>{{ localDigits(session.connections) }}</td></tr>
          <tr v-if="session.started_at > 0"><td>{{ t("$vuetify.networkLatency.sessionTime") }}</td><td>{{ elapsed(session.started_at) }}</td></tr>
          <tr v-if="session.server"><td>{{ t("$vuetify.networkLatency.gameServer") }}</td><td dir="ltr">{{ session.server }}</td></tr>
          </tbody>
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

/* Light: the cards are the background colour, so the labels' backdrop
 * (which blanks the line behind them) is too. */
.v-theme--light .rl {
  --rl-bg: rgb(var(--v-theme-background));
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
.rl--open .rl__map > .rl__game,
.rl--open .rl__map > .v-tooltip-activator {
  transform: translateY(-6px);
}

/* Room on both sides for the names hanging under the ends: the full
 * diagram and the single line alike (not the small click-to-open one). */
.rl:not(.rl--toggle) {
  padding-inline: 40px;
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

.rl__under--ping {
  font-size: 0.6875rem;
  font-weight: 600;
}

/* The game: the icon alone sets its box, so the lines meet the icon's
 * middle; the name hangs under it. */
.rl__game {
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* Centred under the icon; the diagram's side padding leaves it room. */
.rl__game-name {
  position: absolute;
  top: calc(100% + 2px);
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: 96px;
  font-size: 0.6875rem;
  line-height: 1.2;
  text-align: center;
  color: rgba(var(--v-theme-on-surface), 0.8);
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

/* A leg: a solid 1px line, like the curves. */
.rl__leg {
  position: relative;
  flex: 1;
  align-self: center;
  min-width: 26px;
  height: 1px;
  background: var(--rl-line);
}



.rl__leg--join {
  flex: 0 0 22px;
  min-width: 22px;
}

.rl__leg--short {
  flex: 0 0 64px;
}

.rl__leg--tight {
  flex: 0 0 20px;
  min-width: 20px;
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
