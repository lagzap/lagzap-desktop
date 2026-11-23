<script setup lang="ts">
import FlagImg from "~/components/common/FlagImg.vue";
import ContinentIcon from "~/components/icons/ContinentIcon.vue";
import ProfileCard from "~/components/title/ProfileCard.vue";
import { useProfileConnectionStats } from "~/composables/useProfileConnectionStats";
import { DropConnections } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import ProfileConnectionsTable from "~/components/title/ProfileConnectionsTable.vue";
import ProfileRouteSettings from "~/components/title/ProfileRouteSettings.vue";
import ProfileInternetOptions from "~/components/title/ProfileInternetOptions.vue";
import ProfileWireGuard from "~/components/title/ProfileWireGuard.vue";
import { useProfileWireGuard } from "~/composables/useProfileWireGuard";
import { countryName, localDigits } from "~/utils/localeFormat";
import Ping from "~/components/network/Ping.vue";
import { useTitleMenu } from "~/composables/useTitleMenu";
import { useLocalStorage } from "@vueuse/core";
import { useLocale } from "vuetify";
import type { Node, Profile, RelayRoute } from "~/bindings/github.com/lagzap/zap/data";
import { RoutingMode } from "~/bindings/github.com/lagzap/zap/data";
import type { ProfileState } from "~/bindings/github.com/lagzap/zap/data";
import { hasGroup } from "~/utils/profileRoute";
import { ProfileFlag } from "~/constants/profile";
import { useRegionSelection } from "~/composables/useRegionSelection";
import { useStore } from "@/stores";
import { useNodeLocationLabel } from "~/composables/useNodeLocationLabel";
import { recentMinPingMsForRelay } from "~/composables/relayPingDisplay";
import { usePlanAccess } from "~/composables/usePlanAccess";

/* The title's page: a bar with the Server button (where the game connects
 * from; hover: a quick pick) and Route Settings, then the game's live ping,
 * route and chart. The Server button turns the page into the picker:
 * Global, by Region, Country, City, one Server, or Direct, with the
 * game's internets and Dedicated IP. "Login connections" (in Route
 * Settings) makes the first other profile follow the game's choice. */
const props = defineProps<{
  profiles: Profile[];
  gameName?: string;
  gameIcon?: string | null;
  changelogSince?: number | null;
  /** The title has only this profile. */
  single?: boolean;
  /** Every profile of the title: the card shows the one connected. */
  allProfiles?: Profile[];
}>();

const { t } = useLocale();
const store = useStore();
const plan = usePlanAccess();

type Pick = { profile: Profile; sel: ReturnType<typeof useRegionSelection> };
const picks: Pick[] = props.profiles.map((profile) => ({ profile, sel: useRegionSelection(profile) }));
const isGame = (p: Pick) => (p.profile.flags & ProfileFlag.GAME_PACKET) !== 0;
const byOrder = [...picks].sort((a, b) => (a.profile.order ?? 0) - (b.profile.order ?? 0));
/** The game's profile, else the first: its places, ping, route and chart. */
const primary = byOrder.find(isGame) ?? byOrder[0]!;
/** The profile the picker sets: the title's main one, or another one's
 * (a row's Location under Advanced) while the picker is open for it. */
const main = shallowReactive<Pick>({ profile: primary.profile, sel: primary.sel });
const editingPrimary = computed(() => main.profile.id === primary.profile.id);
/** Login connections: the first other profile, next to a game's only. */
const login = byOrder.some(isGame) ? byOrder.find((p) => !isGame(p)) ?? null : null;
const titleId = main.profile.title_id;

const M = RoutingMode;
type Mode = "global" | "region" | "country" | "city" | "server" | "direct";
/** The picker's options: the routing modes, and Dedicated IP. */
type Tab = Mode | "dedicated";
function modeOf(st: { mode?: RoutingMode | null } | undefined): Mode {
  switch (st?.mode) {
    case M.RoutingMode_ROUTING_MODE_REGIONAL:
      return "region";
    case M.RoutingMode_ROUTING_MODE_COUNTRY:
      return "country";
    case M.RoutingMode_ROUTING_MODE_CITY:
      return "city";
    case M.RoutingMode_ROUTING_MODE_NODE:
      return "server";
    case M.RoutingMode_ROUTING_MODE_DIRECT:
      return "direct";
    default:
      return "global";
  }
}
/** The title's state: its route choices, which all its profiles follow
 * unless one sets its own. */
const titleState = computed(() => store.titleStates[titleId]);
/** What the picker edits: the title's choices for the game's card, a
 * profile's own for another one (a row's Location). */
const state = computed<ProfileState | undefined>(() =>
  editingPrimary.value ? (titleState.value as unknown as ProfileState | undefined) : store.profileStates[main.profile.id],
);
const mode = computed(() => modeOf(state.value));
/** Saves what the picker edits: the title's (which its profiles then
 * follow) or the profile's own. */
async function saveChoice(profileId: string) {
  if (profileId !== primary.profile.id) {
    await store.saveProfileState(profileId);
    return;
  }
  // The game's own location (if any) gives way to the title's.
  if (hasGroup(store.ownProfileStates[profileId], "location")) await store.followTitle(profileId, ["location"]);
  await store.saveTitleState(titleId);
}

// ---- what can be picked, with the ping each shows ----

const { routeProbeHistory } = useMonitoringStore();
const { getNodeLabel } = useNodeLocationLabel();
/** A server by its city and number (the digits its name ends in). */
function serverLabel(node: Node): string {
  const city = String(store.localized(node.city) || "") || getNodeLabel(node);
  const num = /(\d+)$/.exec(node.name ?? "")?.[1];
  return num ? `${city} ${num.padStart(2, "0")}` : city;
}
/** The lowest of the recent probes: steady between probe rounds. */
function bestMs(route: RelayRoute | null): number {
  const ms = route ? recentMinPingMsForRelay(route.tag, route, routeProbeHistory.value) : null;
  return ms != null && ms > 0 ? ms : Infinity;
}
/** A tile: a continent, country, city or server. */
type Item = {
  key: string;
  label: string;
  sub?: string;
  country: string;
  region: string;
  /** What it sorts by under Name. */
  name: string;
  tag: string;
  ms: number;
  locked: boolean;
};
/** The list's order: by continent and name, or by ping. */
const sortBy = useLocalStorage<"name" | "ping">("lz-play-from-sort", "name");
const sortOptions = computed(() => [
  { value: "name" as const, title: t("$vuetify.title.playFrom.sortName") },
  { value: "ping" as const, title: t("$vuetify.title.playFrom.sortPing") },
]);
const regionOrder = computed(() => Object.values(store.regions).map((r) => r.tag));
const rank = (tag: string) => {
  const i = regionOrder.value.indexOf(tag);
  return i < 0 ? regionOrder.value.length : i;
};
/** Open ones first, grouped by continent: by name in the app's continent
 * order, or by ping with the continent that has the lowest ping first.
 * Locked ones last. */
function ordered(open: Item[], locked: Item[]): Item[] {
  const byName = (a: Item, b: Item) => rank(a.region) - rank(b.region) || a.name.localeCompare(b.name);
  const regionBest = new Map<string, number>();
  for (const it of open) regionBest.set(it.region, Math.min(regionBest.get(it.region) ?? Infinity, it.ms));
  const best = (it: Item) => regionBest.get(it.region) ?? Infinity;
  const byPing = (a: Item, b: Item) =>
    best(a) - best(b) || rank(a.region) - rank(b.region) || a.ms - b.ms || a.name.localeCompare(b.name);
  return [...open.sort(sortBy.value === "ping" ? byPing : byName), ...locked.sort(byName)];
}
const firstRegion = (nodes: Node[]) => nodes.find((n) => n.region)?.region ?? "";

const cities = computed<Item[]>(() => {
  const sel = main.sel;
  const item = (key: string, nodes: Node[], route: RelayRoute | null, locked: boolean): Item => ({
    key,
    label: sel.getCityLabel(key),
    country: nodes[0]?.country ?? "",
    region: firstRegion(nodes),
    name: nodes.map((n) => n.name ?? "").filter(Boolean).sort()[0] ?? "",
    tag: route?.tag ?? "",
    ms: route ? bestMs(route) : Infinity,
    locked,
  });
  const open = Object.keys(sel.cityMap.value)
    .map((key) => item(key, sel.cityMap.value[key] ?? [], sel.lowestPingForCity(key), false))
    .filter((c) => c.tag && Number.isFinite(c.ms));
  const locked = Object.entries(sel.lockedCityMap.value).map(([key, nodes]) => item(key, nodes, null, true));
  return ordered(open, locked);
});

const countries = computed<Item[]>(() => {
  const sel = main.sel;
  const item = (code: string, nodes: Node[], route: RelayRoute | null, locked: boolean): Item => ({
    key: code,
    label: countryName(code) || code,
    country: code,
    region: firstRegion(nodes),
    name: countryName(code) || code,
    tag: route?.tag ?? "",
    ms: route ? bestMs(route) : Infinity,
    locked,
  });
  const open = Object.entries(sel.areas.value ?? {})
    .map(([code, nodes]) => item(code, nodes as Node[], sel.getLowestPingForCountry(nodes as Node[]), false))
    .filter((c) => c.tag && Number.isFinite(c.ms));
  const locked = Object.entries(sel.lockedAreas.value).map(([code, nodes]) => item(code, nodes, null, true));
  return ordered(open, locked);
});

const servers = computed<Item[]>(() => {
  const sel = main.sel;
  // A server, not a city: its city and its own number (Frankfurt 01),
  // even where the city has only one.
  const item = (node: Node, route: RelayRoute | null, locked: boolean): Item => ({
    key: node.id,
    label: serverLabel(node),
    country: node.country ?? "",
    region: node.region ?? "",
    name: node.name,
    tag: route?.tag ?? "",
    ms: route ? bestMs(route) : Infinity,
    locked,
  });
  const open = Object.values(sel.cityMap.value)
    .flat()
    .map((node) => item(node, sel.getLowestPingForNode(node.name), false))
    .filter((s) => s.tag && Number.isFinite(s.ms));
  const locked = sel.lockedNodes.value.map((node) => item(node, null, true));
  return ordered(open, locked);
});

const continents = computed<Item[]>(() =>
  Object.values(store.regions)
    .map((region) => {
      const inIt = cities.value.filter((c) => c.region === region.tag);
      const open = inIt.filter((c) => !c.locked);
      const best = open.reduce<Item | null>((b, c) => (!b || c.ms < b.ms ? c : b), null);
      return {
        key: region.tag,
        label: main.sel.getRegionLocalizedName(region.tag),
        sub: t("$vuetify.title.playFrom.cityCount", localDigits(open.length)),
        country: "",
        region: region.tag,
        name: "",
        tag: best?.tag ?? "",
        ms: best?.ms ?? Infinity,
        locked: open.length === 0,
        any: inIt.length > 0,
      };
    })
    .filter((c) => c.any),
);
/** The cities Automatic picks from (its servers there), best ping first. */
const autoCities = computed(() =>
  cities.value
    .filter((c) => !c.locked && (main.sel.cityMap.value[c.key] ?? []).some(main.sel.autoPickable))
    .sort((a, b) => a.ms - b.ms),
);
/** Global's ping: the best open city's. */
const fastest = computed(() =>
  cities.value.filter((c) => !c.locked).reduce<Item | null>((b, c) => (!b || c.ms < b.ms ? c : b), null),
);

// ---- picking ----

/** Dedicated IP: a choice of its own in the picker. On, it is what the
 * game uses (the relay goes toward the WireGuard server); any other choice
 * applied turns it off. */
const { summary: wireguard, selected: wireguardPicked, setEnabled: setWireGuard } = useProfileWireGuard(main.profile.id);
const dedicatedOn = computed(() => wireguard.value.enabled && !!wireguardPicked.value);
/** The choice in use: Dedicated IP while it is on, else the mode. */
const inUse = computed<Tab>(() => (dedicatedOn.value ? "dedicated" : mode.value));

/** Login connections ticked: the login profile follows the title's place
 * (it has none of its own); unticked, it goes Automatic on its own. */
const loginFollows = computed(() => !!login && !hasGroup(store.ownProfileStates[login.profile.id], "location"));
async function setLoginFollows(on: boolean | null) {
  if (!login) return;
  if (on) {
    await store.followTitle(login.profile.id, ["location"]);
    return;
  }
  const st = store.profileStates[login.profile.id];
  if (!st) return;
  st.node_id = null;
  st.mode = M.RoutingMode_ROUTING_MODE_GLOBAL;
  await store.saveProfileState(login.profile.id);
}

/** A quick pick in progress: saved and applied once it settles. */
let applying: Promise<void> = Promise.resolve();
/** The hover's quick pick: one city, or Global, right away. */
function quickPick(key: string) {
  const st = state.value;
  if (!st) return;
  const before = oldRegionTcp();
  const id = main.profile.id;
  const wireGuardOff = dedicatedOn.value;
  st.node_id = null;
  if (key) {
    st.cities = [key];
    st.mode = M.RoutingMode_ROUTING_MODE_CITY;
  } else {
    st.mode = M.RoutingMode_ROUTING_MODE_GLOBAL;
  }
  // The drop (if asked for) waits for this: dropped before the new place
  // is applied, they would just reconnect to the old one.
  applying = (async () => {
    if (wireGuardOff) await setWireGuard(false);
    await saveChoice(id);
  })();
  quickOpen.value = false;
  if (before.ids.length && before.place !== selected.value.label) askFor({ leaving: false, old: before, quick: true });
}

// ---- one question before the change ----

/** After the game's place changes, new connections go to the new one and
 * UDP moves on its own, but open TCP connections stay where they were until
 * they close. One dialog asks it all: apply the unsaved changes (when
 * leaving the picker), and whether to drop those TCP connections too. */
type OldRegion = { ids: string[]; place: string };
type Ask = {
  /** Back with changes not applied: Discard is a choice too. */
  leaving: boolean;
  /** TCP connections on the old place, if any. */
  old: OldRegion | null;
  /** A quick pick: already applied, only the drop is asked. */
  quick: boolean;
};
/** The live connections. */
const { connections: liveConnections } = useMonitoringStore();
const ask = ref<Ask | null>(null);
const dropToo = ref(false);
/** The title's main profile's (and a following login's) TCP connections
 * now, with the place they are on. */
function oldRegionTcp(): OldRegion {
  const ids = new Set([main.profile.id, ...(login && loginFollows.value ? [login.profile.id] : [])]);
  return {
    ids: (liveConnections.value ?? [])
      .filter((c) => ids.has(c.profile_id) && String(c.network ?? "").toLowerCase().startsWith("tcp"))
      .map((c) => String(c.id)),
    place: selected.value.label,
  };
}
/** The draft's old-place connections, when it moves the game. */
function oldForDraft(): OldRegion | null {
  if (!editingPrimary.value || !placeChanges()) return null;
  const old = oldRegionTcp();
  return old.ids.length ? old : null;
}
/** Still open of the ones asked about (closed ones leave the list). */
const oldLeft = computed(() => {
  const open = new Set((liveConnections.value ?? []).map((c) => String(c.id)));
  return (ask.value?.old?.ids ?? []).filter((id) => open.has(id));
});
watch(oldLeft, (left) => {
  const a = ask.value;
  if (!a?.old || left.length) return;
  // They all closed meanwhile: nothing to drop.
  if (a.quick) ask.value = null;
  else if (!a.leaving) void confirmApply();
  else a.old = null;
});
async function drop(ids: string[]) {
  if (!ids.length) return;
  try {
    await DropConnections(ids);
  } catch {
    // service not running
  }
}
/** Apply Route: applies, then drops the old connections if ticked (new
 * ones go to the new place first). */
async function confirmApply() {
  const ids = dropToo.value ? oldLeft.value : [];
  ask.value = null;
  // Applied first (saved and in place), then dropped: they reconnect on
  // the new place.
  try {
    await commit();
  } catch {
    return;
  }
  await drop(ids);
}
/** A quick pick's Drop: after the new place is applied. */
async function confirmDrop() {
  const ids = oldLeft.value;
  ask.value = null;
  try {
    await applying;
  } catch {
    return;
  }
  await drop(ids);
}
function discard() {
  ask.value = null;
  closePlaces(true);
}
function askFor(a: Ask) {
  dropToo.value = false;
  ask.value = a;
}
const quickOpen = ref(false);
/** The quick pick's list: the open cities, in the picker's order. */
const quickCities = computed(() => cities.value.filter((c) => !c.locked));

/** The picker's choice, kept apart until Apply. */
type Draft = {
  mode: Mode;
  regions: string[];
  countries: string[];
  cities: string[];
  node: string | null;
  adapter: string;
  dedicated: boolean;
};
function currentChoice(): Draft {
  const st = state.value;
  return {
    mode: mode.value,
    regions: [...(st?.regions ?? [])],
    countries: [...(st?.countries ?? [])],
    cities: [...(st?.cities ?? [])],
    node: st?.node_id ?? null,
    adapter: st?.default_interface ?? "",
    dedicated: dedicatedOn.value,
  };
}
const draft = ref<Draft>(currentChoice());
const draftFrom = ref("");
const dirty = computed(() => JSON.stringify(draft.value) !== draftFrom.value);
/** The picker's choice: Dedicated IP while picked, else the mode. */
const draftInUse = computed<Tab>(() => (draft.value.dedicated ? "dedicated" : draft.value.mode));

function pickGlobal() {
  draft.value.dedicated = false;
  draft.value.mode = "global";
}
/** Direct: no LagZap server; then its adapter. */
function pickDirect() {
  draft.value.dedicated = false;
  draft.value.mode = "direct";
}
/** Direct's adapter: the system's ("") or one of them. */
function pickAdapter(name: string) {
  draft.value.adapter = name;
}
/** Dedicated IP: its saved config picked (the panel), or the sidebar
 * while one is picked already. */
function pickDedicated() {
  if (wireguardPicked.value) draft.value.dedicated = true;
}
/** Dedicated IP's relay: toward the WireGuard server (Automatic) or one
 * server; the tunnel rides what the game's own choice picks. */
function pickRelay(node: string | null) {
  const d = draft.value;
  if (node === "direct") {
    d.mode = "direct";
  } else if (node) {
    d.node = node;
    d.mode = "server";
  } else {
    d.mode = "global";
  }
  pickDedicated();
}
/** Region, Country, City: a click adds or takes away. */
function toggle(kind: "region" | "country" | "city", item: Item) {
  if (item.locked) {
    closePlaces(true);
    plan.openUpgrade();
    return;
  }
  const d = draft.value;
  const field = kind === "region" ? "regions" : kind === "country" ? "countries" : "cities";
  // A new way of picking starts from this one alone.
  const had = new Set(d.mode === kind ? d[field] : []);
  if (had.has(item.key)) had.delete(item.key);
  else had.add(item.key);
  d.dedicated = false;
  d[field] = [...had];
  d.mode = had.size ? kind : "global";
}
/** One server. */
function pickServer(item: Item) {
  if (item.locked) {
    closePlaces(true);
    plan.openUpgrade();
    return;
  }
  draft.value.dedicated = false;
  draft.value.node = item.key;
  draft.value.mode = "server";
}
function isPicked(kind: Tab, key: string): boolean {
  const d = draft.value;
  if (d.dedicated || d.mode !== kind) return false;
  if (kind === "region") return d.regions.includes(key);
  if (kind === "country") return d.countries.includes(key);
  if (kind === "city") return d.cities.includes(key);
  if (kind === "server") return d.node === key;
  return false;
}
const MODE_VALUE: Record<Mode, RoutingMode> = {
  global: M.RoutingMode_ROUTING_MODE_GLOBAL,
  region: M.RoutingMode_ROUTING_MODE_REGIONAL,
  country: M.RoutingMode_ROUTING_MODE_COUNTRY,
  city: M.RoutingMode_ROUTING_MODE_CITY,
  server: M.RoutingMode_ROUTING_MODE_NODE,
  direct: M.RoutingMode_ROUTING_MODE_DIRECT,
};
/** The draft moves the game somewhere else (not only its adapter). */
function placeChanges(): boolean {
  const place = (d: Draft) => JSON.stringify({ ...d, adapter: "" });
  return place(draft.value) !== place(JSON.parse(draftFrom.value || "{}") as Draft);
}
/** Apply Route: when the game moves with TCP connections open on the old
 * place, the dialog asks first (here, on the picker). */
function apply() {
  const old = oldForDraft();
  if (old) askFor({ leaving: false, old, quick: false });
  else void commit();
}
/** The draft becomes the game's choice (and its login's). The picker
 * closes at once; the saves go on behind it. */
function commit(): Promise<void> {
  const st = state.value;
  const d = draft.value;
  const id = main.profile.id;
  const from = JSON.parse(draftFrom.value || "{}") as Partial<Draft>;
  // Dedicated IP is the title's main profile's (the picker hides it for
  // another one).
  const wireGuard = editingPrimary.value && d.dedicated !== dedicatedOn.value ? d.dedicated : null;
  if (st) {
    st.regions = [...d.regions];
    st.countries = [...d.countries];
    st.cities = [...d.cities];
    st.node_id = d.mode === "server" ? d.node : null;
    // The adapter only when changed: the title's internets are a choice
    // its profiles follow.
    if (d.adapter !== (from.adapter ?? "")) st.default_interface = d.adapter;
    st.mode = MODE_VALUE[d.mode];
  }
  closePlaces(true);
  // Saved now, not after the usual pause: the route (and a Dedicated IP
  // tunnel's relay) moves right away.
  return (async () => {
    if (st) await saveChoice(id);
    if (wireGuard !== null) await setWireGuard(wireGuard);
  })();
}

// ---- the picker page ----

const placesOpen = ref(false);
/** The page shows only the picker meanwhile. */
const emit = defineEmits<{ picking: [boolean] }>();
// The page's title bar has the picker's Back.
defineExpose({ closePlaces: () => closePlaces(), openFor });
watch(placesOpen, (open) => emit("picking", open));
/** The internets menu on the picker's card. */
const internetsOpen = ref(false);
const wgPanel = ref<{ startAdding: () => void } | null>(null);
/** The left column's choice: what the tiles on the right are. */
const tab = ref<Tab>("global");
const modes = computed(() => [
  { value: "global" as Mode, icon: "mdi-lightning-bolt", title: t("$vuetify.title.profile.server.automatic") },
  { value: "region" as Mode, icon: "mdi-earth", title: t("$vuetify.title.profile.server.byRegion") },
  { value: "country" as Mode, icon: "mdi-flag-outline", title: t("$vuetify.title.profile.server.byCountry") },
  { value: "city" as Mode, icon: "mdi-city-variant-outline", title: t("$vuetify.title.profile.server.byCity") },
  { value: "server" as Mode, icon: "mdi-server-outline", title: t("$vuetify.title.profile.server.server") },
  { value: "dedicated" as Tab, icon: "mdi-tunnel-outline", title: t("$vuetify.title.profile.wireguard.title") },
  { value: "direct" as Mode, icon: "mdi-call-split", title: t("$vuetify.title.profile.server.directWithoutServer") },
].filter((m) => m.value !== "dedicated" || editingPrimary.value));
/** Slides: forward into the picker and down the modes, back out of it. */
const slide = ref<"fwd" | "back">("fwd");
function openPlaces() {
  draft.value = currentChoice();
  if (!editingPrimary.value) draft.value.dedicated = false;
  draftFrom.value = JSON.stringify(draft.value);
  tab.value = editingPrimary.value ? inUse.value : mode.value;
  slide.value = "fwd";
  placesOpen.value = true;
}
/** Back: unapplied changes ask first (Apply, Discard, or stay). */
function closePlaces(force = false) {
  if (!force && dirty.value) {
    askFor({ leaving: true, old: oldForDraft(), quick: false });
    return;
  }
  slide.value = "back";
  placesOpen.value = false;
  // Back to the title's main profile.
  main.profile = primary.profile;
  main.sel = primary.sel;
}
/** The picker for another of the title's profiles (its row's Location). */
function openFor(profileId: string) {
  const p = picks.find((x) => x.profile.id === profileId);
  if (!p) return;
  main.profile = p.profile;
  main.sel = p.sel;
  openPlaces();
  window.scrollTo({ top: 0 });
}
/** The card's height eases from one tab's content to the next. */
const tabViewport = ref<HTMLElement | null>(null);
let leavingHeight = 0;
function tabBeforeLeave(el: Element) {
  const box = tabViewport.value;
  leavingHeight = (el as HTMLElement).offsetHeight;
  if (!box) return;
  box.style.height = `${leavingHeight}px`;
}
function tabEnter(el: Element) {
  const box = tabViewport.value;
  if (!box) return;
  const next = (el as HTMLElement).offsetHeight;
  requestAnimationFrame(() => (box.style.height = `${next}px`));
}
function tabAfterEnter() {
  const box = tabViewport.value;
  if (box) box.style.height = "";
}
/** The card's content slides up or down: down the sidebar (City to
 * Server) comes in from below, up it (City to Country) from above. */
const tabSlide = ref<"down" | "up">("down");
function setTab(next: Tab) {
  const order = modes.value.map((m) => m.value);
  tabSlide.value = order.indexOf(next) >= order.indexOf(tab.value) ? "down" : "up";
  tab.value = next;
}
const tiles = computed<Item[]>(() => {
  switch (tab.value) {
    case "region":
      return continents.value;
    case "country":
      return countries.value;
    case "city":
      return cities.value;
    case "server":
      return servers.value;
    default:
      return [];
  }
});
/** A continent's name over its tiles (by name), the locked ones apart. */
function heading(list: Item[], i: number): string {
  const it = list[i]!;
  const prev = list[i - 1];
  if (it.locked) return prev?.locked ? "" : t("$vuetify.plan.moreAccess");
  if (tab.value === "region" || !it.region) return "";
  return prev?.region === it.region ? "" : main.sel.getRegionLocalizedName(it.region);
}
function clickTile(item: Item) {
  if (tab.value === "server") pickServer(item);
  else if (tab.value === "region" || tab.value === "country" || tab.value === "city") toggle(tab.value, item);
}

/** The Server button: what the game connects from now. */
const selected = computed(() => {
  if (dedicatedOn.value) {
    const c = wireguardPicked.value;
    return { icon: c?.country ? "" : "mdi-tunnel-outline", country: c?.country ?? "", label: t("$vuetify.title.profile.wireguard.title") };
  }
  const st = state.value;
  const more = (n: number) => (n > 1 ? ` +${localDigits(n - 1)}` : "");
  switch (mode.value) {
    case "region": {
      const list = st?.regions ?? [];
      return { icon: "mdi-earth", country: "", label: `${list[0] ? main.sel.getRegionLocalizedName(list[0]) : ""}${more(list.length)}` };
    }
    case "country": {
      const list = st?.countries ?? [];
      return { icon: "", country: list[0] ?? "", label: `${countryName(list[0] ?? "") || list[0] || ""}${more(list.length)}` };
    }
    case "city": {
      const list = st?.cities ?? [];
      const city = cities.value.find((c) => c.key === list[0]);
      return { icon: city?.country ? "" : "mdi-city-variant-outline", country: city?.country ?? "", label: `${city?.label ?? ""}${more(list.length)}` };
    }
    case "server": {
      const node = st?.node_id ? store.nodes[st.node_id] : undefined;
      return { icon: node?.country ? "" : "mdi-server-outline", country: node?.country ?? "", label: node ? serverLabel(node) : "" };
    }
    case "direct":
      return { icon: "mdi-call-split", country: "", label: t("$vuetify.title.profile.server.directWithoutServer") };
    default:
      return { icon: "mdi-lightning-bolt", country: "", label: t("$vuetify.title.profile.server.automatic") };
  }
});
const selectedMs = computed(() => {
  if (mode.value === "direct" || dedicatedOn.value) return undefined;
  if (mode.value === "global") return fastest.value?.ms;
  const ms = main.sel.bestPingMsForCurrentSelection.value;
  return ms != null && ms > 0 ? ms : undefined;
});

// ---- the rest of the page ----

/** The card is the title's: it shows the profile in use, by kind (the
 * game's first, then downloads, then voice and other multi-path ones, then
 * the rest), else the main one; the next one in use shows under it. */
function kindRank(p: Profile): number {
  if ((p.flags & ProfileFlag.GAME_PACKET) !== 0) return 0;
  if ((p.flags & ProfileFlag.HIGH_TRAFFIC) !== 0) return 1;
  if ((p.flags & ProfileFlag.MULTIPATH) !== 0) return 2;
  return 3;
}
const candidates = [...(props.allProfiles?.length ? props.allProfiles : props.profiles)].sort(
  (a, b) => kindRank(a) - kindRank(b) || (a.order ?? 0) - (b.order ?? 0),
);
const candidateStats = candidates.map((p) => ({ profile: p, stats: useProfileConnectionStats(() => p.id) }));
const usedProfiles = computed(() =>
  candidateStats.filter((c) => store.isProfileActive(c.profile.id) && c.stats.connected.value).map((c) => c.profile),
);
const shown = computed<Profile>(() => usedProfiles.value[0] ?? main.profile);
/** The next profile in use, said under the card's status: a game's,
 * downloads or voice (not login connections and the like). */
const alsoInUse = computed<Profile | null>(
  () => usedProfiles.value.find((p) => p.id !== shown.value.id && kindRank(p) < 3) ?? null,
);

/** The title's connections now, every profile's (their own card, under
 * the title's). */
const { connections } = useMonitoringStore();
const titleProfileIds = (props.allProfiles?.length ? props.allProfiles : props.profiles).map((p) => p.id);
const connectionCount = computed(
  () => (connections.value ?? []).filter((c) => titleProfileIds.includes(c.profile_id)).length,
);

/** Route Settings, from its button in the bar (Login connections on top). */
const routeSettingsOpen = ref(false);
const routeBtn = ref<{ $el: Element } | null>(null);

// A title's right-click menu asked for its location: the picker.
const titleMenu = useTitleMenu();
onMounted(() => {
  if (titleMenu.take(titleId, "location")) openPlaces();
});
</script>

<template>
  <!-- The game's page and the picker slide past each other. -->
  <div class="pick-root">
  <Transition :name="`pick-slide-${slide}`">
    <!-- The picker: the whole page, until Global, a server, or Back. -->
    <div v-if="placesOpen" key="pick" class="pick-page">
      <div class="pick-page__top">
        <span class="pick-page__title">{{ t("$vuetify.title.playFrom.pickTitle", editingPrimary ? gameName ?? "" : String(store.localized(main.profile.name) || "")) }}</span>
        <v-spacer />
        <v-btn color="success" variant="flat" prepend-icon="mdi-check" class="text-none" :disabled="!dirty" @click="apply">
          {{ t("$vuetify.title.playFrom.applyRoute") }}
        </v-btn>
      </div>
      <div class="pick-page__cols">
        <!-- How to pick: a sidebar; the dot marks the way it picks now. -->
        <v-card variant="flat" rounded="lg" class="pick-page__side">
          <v-list nav density="comfortable" bg-color="transparent">
            <v-list-item
              v-for="m in modes"
              :key="m.value"
              :active="tab === m.value"
              color="primary"
              :prepend-icon="m.icon"
              :title="m.title"
              @click="
                m.value === 'global'
                  ? (setTab('global'), pickGlobal())
                  : m.value === 'direct'
                    ? (setTab('direct'), pickDirect())
                    : m.value === 'dedicated'
                      ? (setTab('dedicated'), pickDedicated())
                      : setTab(m.value)
              "
            >
              <template #append>
                <span v-if="m.value === 'global'" class="pick-side__tag">{{ t("$vuetify.title.playFrom.recommended") }}</span>
                <v-icon v-else-if="draftInUse === m.value" icon="mdi-check" size="18" color="primary" />
              </template>
            </v-list-item>
          </v-list>
        </v-card>

        <!-- What to pick, on its own card: its title, then the sort and
             the internets at the top right. -->
        <v-card variant="flat" rounded="lg" class="pick-page__main">
          <div class="pick-main__head">
            <span class="pick-main__title">{{ modes.find((m) => m.value === tab)?.title }}</span>
            <v-spacer />
            <div v-if="tab === 'country' || tab === 'city' || tab === 'server'" class="d-flex ga-2">
              <v-chip
                v-for="opt in sortOptions"
                :key="opt.value"
                size="small"
                variant="tonal"
                :color="sortBy === opt.value ? 'primary' : undefined"
                @click="sortBy = opt.value"
              >
                {{ opt.title }}
              </v-chip>
            </div>
            <!-- Dedicated IP: add a config. -->
            <v-btn
              v-if="tab === 'dedicated'"
              color="primary"
              variant="tonal"
              prepend-icon="mdi-plus"
              class="text-none"
              @click="wgPanel?.startAdding()"
            >
              {{ t("$vuetify.title.profile.wireguard.add") }}
            </v-btn>
            <!-- Its internets (Multi Internet, load balancing or Split
                 Tunnel), in a menu. -->
            <v-menu v-if="tab !== 'direct'" v-model="internetsOpen" location="bottom end" :close-on-content-click="false">
              <template #activator="{ props: menuProps }">
                <v-btn v-bind="menuProps" variant="tonal" size="small" prepend-icon="mdi-lan" class="text-none">
                  {{ t("$vuetify.title.playFrom.internets") }}
                </v-btn>
              </template>
              <v-card min-width="320" max-width="380">
                <ProfileInternetOptions
                  :profile="main.profile"
                  :sel="main.sel"
                  :live="internetsOpen"
                  :for-title="editingPrimary"
                  no-dedicated-ip
                />
              </v-card>
            </v-menu>
          </div>

          <div ref="tabViewport" class="pick-tab-viewport">
          <Transition
            :name="`pick-tab-${tabSlide}`"
            mode="out-in"
            @before-leave="tabBeforeLeave"
            @enter="tabEnter"
            @after-enter="tabAfterEnter"
          >
            <!-- Automatic: how it works, and the servers it picks from. -->
            <div v-if="tab === 'global'" key="global" class="pick-auto">
              <v-icon icon="mdi-lightning-bolt" size="40" color="primary" />
              <div class="pick-auto__title">{{ t("$vuetify.title.playFrom.autoTitle") }}</div>
              <div class="pick-auto__body">{{ t("$vuetify.title.playFrom.autoBody") }}</div>
              <!-- A few it favors now; where the game's server is decides. -->
              <div class="pick-auto__note">{{ t("$vuetify.title.playFrom.autoNote") }}</div>
              <div class="pick-auto__chips">
                <v-chip v-for="c in autoCities.slice(0, 4)" :key="c.key" size="small" variant="tonal">
                  <FlagImg v-if="c.country" :country="c.country" :height="12" class="me-2" />
                  {{ c.label }}
                  <Ping :tag="c.tag" :latency-ms="c.ms" class="ms-2" />
                </v-chip>
              </div>
            </div>
            <!-- Dedicated IP: its configs; picking one turns it on. -->
            <div v-else-if="tab === 'dedicated'" key="dedicated">
              <ProfileWireGuard ref="wgPanel" panel :profile-id="main.profile.id" :disabled="!store.appReady" @picked="draft.dedicated = true" />
              <!-- The relay the tunnel rides: picked toward the WireGuard
                   server, or one server. -->
              <v-divider class="my-5" />
              <div class="pick-relay__head">
                <span class="pick-main__title">{{ t("$vuetify.title.playFrom.relay") }}</span>
                <span class="pick-relay__hint">{{ t("$vuetify.title.playFrom.relayHint") }}</span>
              </div>
              <div class="pick-page__tiles">
                <button
                  type="button"
                  class="pick-tile"
                  :class="{ 'pick-tile--on': draft.mode !== 'server' && draft.mode !== 'direct' }"
                  @click="pickRelay(null)"
                >
                  <span class="pick-tile__row">
                    <v-icon icon="mdi-lightning-bolt" size="18" />
                    <span class="pick-tile__name">{{ t("$vuetify.title.profile.server.automatic") }}</span>
                    <v-icon v-if="draft.mode !== 'server' && draft.mode !== 'direct'" icon="mdi-check-circle" size="18" color="primary" />
                  </span>
                </button>
                <!-- Straight to the WireGuard server, no LagZap server. -->
                <button
                  type="button"
                  class="pick-tile"
                  :class="{ 'pick-tile--on': draft.mode === 'direct' }"
                  @click="pickRelay('direct')"
                >
                  <span class="pick-tile__row">
                    <v-icon icon="mdi-call-split" size="18" />
                    <span class="pick-tile__name">{{ t("$vuetify.title.playFrom.direct") }}</span>
                    <v-icon v-if="draft.mode === 'direct'" icon="mdi-check-circle" size="18" color="primary" />
                  </span>
                </button>
                <button
                  v-for="item in servers.filter((x) => !x.locked)"
                  :key="item.key"
                  type="button"
                  class="pick-tile"
                  :class="{ 'pick-tile--on': draft.mode === 'server' && draft.node === item.key }"
                  @click="pickRelay(item.key)"
                >
                  <span class="pick-tile__row">
                    <FlagImg v-if="item.country" :country="item.country" :height="14" />
                    <span class="pick-tile__name">{{ item.label }}</span>
                    <Ping :tag="item.tag" :latency-ms="item.ms" />
                    <v-icon v-if="draft.mode === 'server' && draft.node === item.key" icon="mdi-check-circle" size="18" color="primary" />
                  </span>
                </button>
              </div>
            </div>
            <!-- Direct: the adapter it goes straight out through. -->
            <div v-else-if="tab === 'direct'" key="direct" class="pick-page__tiles">
              <div class="pick-page__heading">{{ t("$vuetify.title.profile.server.directThrough") }}</div>
              <button
                v-for="name in ['', ...(main.sel.interfaces.value ?? []).map((i) => i.Name)]"
                :key="name || 'system'"
                type="button"
                class="pick-tile"
                :class="{ 'pick-tile--on': draft.mode === 'direct' && draft.adapter === name }"
                @click="pickAdapter(name)"
              >
                <span class="pick-tile__row">
                  <v-icon :icon="name ? 'mdi-network' : 'mdi-auto-fix'" size="18" />
                  <span class="pick-tile__name">{{ name || t("$vuetify.title.profile.server.directSystemDefault") }}</span>
                  <v-icon v-if="draft.mode === 'direct' && draft.adapter === name" icon="mdi-check-circle" size="18" color="primary" />
                </span>
              </button>
            </div>
            <!-- Automatic: picked already; the places it picks from. -->
            <div v-else :key="tab" class="pick-page__tiles" :class="{ 'pick-page__tiles--wide': tab === 'region' }">
              <template v-for="(item, i) in tiles" :key="item.key">
                <div v-if="heading(tiles, i)" class="pick-page__heading">{{ heading(tiles, i) }}</div>
                <button
                  type="button"
                  class="pick-tile"
                  :class="{
                    'pick-tile--on': isPicked(tab, item.key),
                    'pick-tile--locked': item.locked,
                    'pick-tile--big': tab === 'region',
                  }"
                  @click="clickTile(item)"
                >
                  <span v-if="tab === 'region'" class="pick-tile__art"><ContinentIcon :tag="item.key" /></span>
                  <span class="pick-tile__row">
                    <FlagImg v-if="item.country" :country="item.country" :height="14" />
                    <span class="pick-tile__name">
                      {{ item.label }}
                      <span v-if="item.sub" class="pick-tile__sub">{{ item.sub }}</span>
                    </span>
                    <v-icon v-if="item.locked" icon="mdi-cart-outline" size="16" color="amber" />
                    <Ping v-else-if="item.tag" :tag="item.tag" :latency-ms="item.ms" />
                    <v-icon v-if="isPicked(tab, item.key)" icon="mdi-check-circle" size="18" color="primary" />
                  </span>
                </button>
              </template>
            </div>
          </Transition>
          </div>
        </v-card>
      </div>
    </div>

    <div v-else key="card" class="d-flex flex-column ga-3">
      <!-- On the page, not a card: the Server button (where the game
           connects from) at the start; Login connections and the route
           counts at the end. -->
      <div class="play-from__bar">
        <!-- Hover: the quick pick (Global or a city); click: the picker. -->
        <v-menu v-model="quickOpen" open-on-hover :open-delay="0" :close-delay="150" location="bottom start" max-height="420">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              variant="flat"
              color="surface-container-high"
              size="large"
              class="text-none play-from__server"
              @click="quickOpen = false; openPlaces()"
            >
              <FlagImg v-if="selected.country" :country="selected.country" :height="16" class="me-2" />
              <v-icon v-else :icon="selected.icon" start />
              {{ selected.label }}
              <Ping v-if="selectedMs" :latency-ms="selectedMs" class="ms-3" />
              <v-icon icon="mdi-chevron-right" end />
            </v-btn>
          </template>
          <v-card min-width="260" max-width="320">
            <v-list density="compact" class="py-1">
              <v-list-item
                :active="mode === 'global'"
                color="primary"
                prepend-icon="mdi-lightning-bolt"
                :title="t('$vuetify.title.profile.server.automatic')"
                @click="quickPick('')"
              >
                <template v-if="fastest" #append>
                  <Ping :tag="fastest.tag" :latency-ms="fastest.ms" />
                </template>
              </v-list-item>
              <v-list-item
                v-for="city in quickCities"
                :key="city.key"
                :active="mode === 'city' && (state?.cities ?? []).length === 1 && state?.cities?.[0] === city.key"
                color="primary"
                @click="quickPick(city.key)"
              >
                <template #prepend>
                  <FlagImg v-if="city.country" :country="city.country" :height="14" class="me-3" />
                </template>
                <v-list-item-title>{{ city.label }}</v-list-item-title>
                <template #append>
                  <Ping :tag="city.tag" :latency-ms="city.ms" />
                </template>
              </v-list-item>
            </v-list>
            <v-divider />
            <v-list density="compact" class="py-1">
              <v-list-item
                prepend-icon="mdi-tune-variant"
                :title="t('$vuetify.title.playFrom.moreOptions')"
                @click="quickOpen = false; openPlaces()"
              />
            </v-list>
          </v-card>
        </v-menu>
        <v-spacer />
        <!-- The title on or off. -->
        <slot />
      </div>

      <!-- How it goes: the game's own card, full width (its ping, route
           diagram, chart and hints). -->
      <div class="play-from">
        <ProfileCard
          :key="shown.id"
          :profile="shown"
          :also-in-use="alsoInUse"
          :changelog-since="changelogSince"
          featured
          ping-title
          :single="single"
          :game-name="String(store.localized(shown.name) || gameName || '')"
          :game-icon="gameIcon"
        >
          <!-- Beside ⋮: the game's Route Settings (Login connections on top). -->
          <template #switch>
            <v-btn
              ref="routeBtn"
              variant="flat"
              color="surface-container-high"
              prepend-icon="mdi-tune"
              class="text-none play-from__server me-1"
              @click="routeSettingsOpen = true"
            >
              {{ t("$vuetify.title.profile.routeSettings") }}
            </v-btn>
            <ProfileRouteSettings
              v-model:open="routeSettingsOpen"
              bare
              :target="routeBtn?.$el ?? null"
              :profile="shown"
              title-scope
            >
              <template v-if="login" #top>
                <v-checkbox
                  :model-value="loginFollows"
                  :label="t('$vuetify.title.playFrom.loginConnections')"
                  color="primary"
                  density="compact"
                  hide-details
                  @update:model-value="setLoginFollows"
                />
              </template>
            </ProfileRouteSettings>
          </template>
        </ProfileCard>
      </div>
      <!-- The game's connections, on a card of their own under it. -->
      <v-card v-if="connectionCount > 0" variant="flat" rounded="lg" class="play-from__conns">
        <v-card-item>
          <v-card-title class="d-flex align-center ga-2 text-subtitle-1">
            {{ t("$vuetify.title.profile.connections") }}
            <span class="play-from__count">{{ localDigits(connectionCount) }}</span>
          </v-card-title>
        </v-card-item>
        <v-card-text class="pt-0">
          <ProfileConnectionsTable :profile-id="main.profile.id" :profile-ids="titleProfileIds" :limit="5" />
        </v-card-text>
      </v-card>
    </div>
  </Transition>
    <!-- One question: apply the changes, and drop the old place's TCP
         connections too? (A quick pick only asks the drop.) -->
    <v-dialog :model-value="!!ask" max-width="420" persistent>
      <v-card v-if="ask" rounded="lg">
        <v-card-title>
          {{ t(ask.quick ? "$vuetify.title.playFrom.dropTitle" : "$vuetify.title.playFrom.unsavedTitle") }}
        </v-card-title>
        <v-card-text>
          <p v-if="ask.leaving">{{ t("$vuetify.title.playFrom.unsavedBody") }}</p>
          <p v-if="ask.old && ask.quick">
            {{ t("$vuetify.title.playFrom.dropBody", localDigits(oldLeft.length), ask.old.place) }}
          </p>
          <!-- Drop them too: a card that turns on and off as a whole. -->
          <v-card
            v-else-if="ask.old"
            :color="dropToo ? 'error' : 'surface-container-high'"
            :variant="dropToo ? 'tonal' : 'flat'"
            rounded="lg"
            role="switch"
            :aria-checked="dropToo"
            :class="{ 'mt-3': ask.leaving }"
            @click="dropToo = !dropToo"
          >
            <v-card-item>
              <template #prepend>
                <v-icon icon="mdi-lan-disconnect" />
              </template>
              <v-card-title class="text-body-1">{{ t("$vuetify.title.playFrom.dropCheck") }}</v-card-title>
              <v-card-subtitle class="drop-card__sub">
                {{ t("$vuetify.title.playFrom.dropCheckHint", localDigits(oldLeft.length), ask.old.place) }}
              </v-card-subtitle>
              <template #append>
                <v-switch
                  :model-value="dropToo"
                  color="error"
                  density="compact"
                  hide-details
                  inset
                  class="ms-2"
                  @click.stop
                  @update:model-value="dropToo = !!$event"
                />
              </template>
            </v-card-item>
          </v-card>
        </v-card-text>
        <v-card-actions>
          <template v-if="ask.quick">
            <v-btn class="text-none" @click="ask = null">{{ t("$vuetify.title.playFrom.dropKeep") }}</v-btn>
            <v-spacer />
            <v-btn class="text-none" color="error" variant="flat" @click="confirmDrop">{{ t("$vuetify.title.playFrom.dropYes") }}</v-btn>
          </template>
          <template v-else>
            <v-btn class="text-none" @click="ask = null">{{ t("$vuetify.title.playFrom.keepEditing") }}</v-btn>
            <v-spacer />
            <v-btn v-if="ask.leaving" class="text-none" color="error" @click="discard">{{ t("$vuetify.title.playFrom.discard") }}</v-btn>
            <v-btn class="text-none" color="success" variant="flat" @click="confirmApply">{{ t("$vuetify.title.playFrom.applyRoute") }}</v-btn>
          </template>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* The drop card's details wrap (a subtitle is one line by default). */
.drop-card__sub {
  white-space: normal;
  opacity: 1;
}
/* Slides: forward comes in from the end, back from the start. */
.pick-slide-fwd-enter-active,
.pick-slide-fwd-leave-active,
.pick-slide-back-enter-active,
.pick-slide-back-leave-active {
  transition: transform 0.22s ease, opacity 0.22s ease;
}

.pick-root {
  position: relative;
  overflow-x: hidden;
}

/* The page leaving lies over the one arriving while they move. */
.pick-slide-fwd-leave-active,
.pick-slide-back-leave-active {
  position: absolute;
  inset: 0 0 auto;
}

.pick-slide-fwd-enter-from,
.pick-slide-back-leave-to {
  opacity: 0;
  transform: translateX(32px);
}

.pick-slide-fwd-leave-to,
.pick-slide-back-enter-from {
  opacity: 0;
  transform: translateX(-32px);
}

/* The card's content slides with the sidebar: the old fades out, then the
 * new fades in, down the list from below, up it from above. */
.pick-tab-viewport {
  position: relative;
  overflow: hidden;
  transition: height 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Each tab's content fills the card to the window's bottom. */
.pick-tab-viewport > * {
  min-height: calc(100vh - 250px);
}

.pick-tab-down-enter-active,
.pick-tab-down-leave-active,
.pick-tab-up-enter-active,
.pick-tab-up-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.pick-tab-down-enter-from,
.pick-tab-up-leave-to {
  opacity: 0;
  transform: translateY(24px);
}

.pick-tab-down-leave-to,
.pick-tab-up-enter-from {
  opacity: 0;
  transform: translateY(-24px);
}

/* Right to left: the same slides, mirrored. */
.v-locale--is-rtl .pick-slide-fwd-enter-from,
.v-locale--is-rtl .pick-slide-back-leave-to {
  transform: translateX(-32px);
}

.v-locale--is-rtl .pick-slide-fwd-leave-to,
.v-locale--is-rtl .pick-slide-back-enter-from {
  transform: translateX(32px);
}

.play-from__bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 16px;
  padding: 4px 2px 0;
}

.play-from__server {
  letter-spacing: normal;
}

/* Its height is its parts': the top, the diagram, the chart. */
.play-from {
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}

.v-theme--light .play-from,
.v-theme--light .play-from__conns {
  background: rgb(var(--v-theme-background));
}

/* The game's card fills it, on the same surface. */
.play-from :deep(.profile-card) {
  flex: 1;
  background: transparent !important;
}

.play-from__count {
  padding: 0 6px;
  border-radius: 999px;
  font-size: 0.6875rem;
  background: rgba(var(--v-theme-on-surface), 0.08);
}

/* The picker page. */
.pick-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: calc(100vh - 100px);
}

.pick-page__top {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-inline-start: 4px;
}

.pick-page__title {
  font-size: 1.25rem;
  font-weight: 500;
}

.pick-page__cols {
  flex: 1;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 12px;
  overflow: hidden;
}

.pick-page__side {
  background: rgb(var(--v-theme-surface));
}

.pick-side__tag {
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 0.6875rem;
  color: rgb(var(--v-theme-success));
  background: rgba(var(--v-theme-success), 0.14);
}

.pick-page__main {
  min-width: 0;
  padding: 14px 16px 16px;
  background: rgb(var(--v-theme-surface));
}

.v-theme--light .pick-page__side,
.v-theme--light .pick-page__main {
  background: rgb(var(--v-theme-background));
}

.pick-relay__head {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 10px;
}

.pick-relay__hint {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.pick-auto {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px 16px;
  text-align: center;
}

.pick-auto__title {
  font-size: 1.125rem;
  font-weight: 500;
}

.pick-auto__body {
  max-width: 440px;
  font-size: 0.875rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.pick-auto__note {
  margin-top: 12px;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.pick-auto__chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  max-width: 560px;
}

.pick-main__head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.pick-main__title {
  font-size: 1rem;
  font-weight: 500;
}

.pick-page__tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 8px;
  align-content: start;
}

.pick-page__tiles--wide {
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
}

.pick-page__heading {
  grid-column: 1 / -1;
  padding: 6px 2px 0;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.pick-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 12px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  color: inherit;
  font: inherit;
  font-size: 0.875rem;
  text-align: start;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.pick-tile:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.2);
}

.pick-tile--on {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
}

.pick-tile--locked {
  opacity: 0.6;
}

.pick-tile--big {
  height: 280px;
}

/* The continent's shape, large and faint behind its name. */
.pick-tile__art {
  position: absolute;
  inset: 8px 8px 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.18;
  pointer-events: none;
}

.pick-tile__art :deep(svg) {
  width: 100%;
  height: 100%;
}

.pick-tile__row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
}

.pick-tile__name {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.pick-tile__sub {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}


/* Narrow: the ways to pick above the tiles. */
@media (max-width: 760px) {
  .pick-page__cols {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
