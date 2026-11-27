<script setup lang="ts">
import FlagImg from "~/components/common/FlagImg.vue";
import ContinentIcon from "~/components/icons/ContinentIcon.vue";
import ProfileCard from "~/components/title/ProfileCard.vue";
import AdminLogDialog from "~/components/admin/AdminLogDialog.vue";
import { useProfileConnectionStats } from "~/composables/useProfileConnectionStats";
import { DropConnections, SelectProfileWireGuard } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import ProfileConnectionsTable from "~/components/title/ProfileConnectionsTable.vue";
import ProfileRouteSettings from "~/components/title/ProfileRouteSettings.vue";
import ProfileInternetOptions from "~/components/title/ProfileInternetOptions.vue";
import ProfileWireGuard from "~/components/title/ProfileWireGuard.vue";
import { useProfileWireGuard } from "~/composables/useProfileWireGuard";
import { countryName, localDigits } from "~/utils/localeFormat";
import Ping from "~/components/network/Ping.vue";
import { useTitleMenu } from "~/composables/useTitleMenu";
import { useLocalStorage, useNow } from "@vueuse/core";
import { useLocale } from "vuetify";
import type { Node, Profile, RelayRoute } from "~/bindings/github.com/lagzap/zap/data";
import { RoutingMode } from "~/bindings/github.com/lagzap/zap/data";
import type { ProfileState } from "~/bindings/github.com/lagzap/zap/data";
import { hasGroup } from "~/utils/profileRoute";
import { useRouteOverrides } from "~/composables/useRouteOverrides";
import { ProfileFlag } from "~/constants/profile";
import { useRegionSelection } from "~/composables/useRegionSelection";
import { useStore } from "@/stores";
import { useNodeLocationLabel } from "~/composables/useNodeLocationLabel";
import { recentMinPingMsForRelay } from "~/composables/relayPingDisplay";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { useConnectionRejected } from "~/composables/useConnectionRejected";
import UnavailableInternetAlert from "~/components/title/UnavailableInternetAlert.vue";

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

const { t, current: currentLocale } = useLocale();
const store = useStore();
// LagZap paused: a profile that is on shows orange with a pause knob.
const { paused: lagzapPaused } = useLagzapPaused();
const plan = usePlanAccess();

type Pick = { profile: Profile; sel: ReturnType<typeof useRegionSelection> };
const picks: Pick[] = props.profiles.map((profile) => ({ profile, sel: useRegionSelection(profile) }));
const isGame = (p: Pick) => (p.profile.flags & ProfileFlag.GAME_PACKET) !== 0;
const byOrder = [...picks].sort((a, b) => (a.profile.order ?? 0) - (b.profile.order ?? 0));
/** The game's profile; without one, the first plain one (Login
 * connections, not downloads or voice); else the first. Its places, ping,
 * route and chart. */
const isPlain = (p: Pick) => (p.profile.flags & (ProfileFlag.HIGH_TRAFFIC | ProfileFlag.MULTIPATH)) === 0;
const primary = byOrder.find(isGame) ?? byOrder.find(isPlain) ?? byOrder[0]!;
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
const { getNodeNumberedLabel, cityGroupMap } = useNodeLocationLabel();
/** A tile's name split before its number ("Amsterdam", "01"): a long name
 * is cut ("Amste…") but the number always shows, on one line. */
function labelParts(label: string): { head: string; num: string } {
  const m = /^(.*\S)\s+(\d+)$/.exec(label);
  return m ? { head: m[1]!, num: m[2]! } : { head: label, num: "" };
}
function serverLabel(node: Node): string {
  return getNodeNumberedLabel(node);
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
/** Ascending, unavailable (Infinity) last, without NaN from Infinity - Infinity. */
const byMs = (x: number, y: number) => (x === y ? 0 : x < y ? -1 : 1);
/** Whether a place can connect now: a server there has a measured route. */
const available = (it: Item) => Number.isFinite(it.ms);
function ordered(open: Item[], locked: Item[]): Item[] {
  const byName = (a: Item, b: Item) => rank(a.region) - rank(b.region) || a.name.localeCompare(b.name);
  const regionBest = new Map<string, number>();
  for (const it of open) regionBest.set(it.region, Math.min(regionBest.get(it.region) ?? Infinity, it.ms));
  const best = (it: Item) => regionBest.get(it.region) ?? Infinity;
  const byPing = (a: Item, b: Item) =>
    byMs(best(a), best(b)) || rank(a.region) - rank(b.region) || byMs(a.ms, b.ms) || a.name.localeCompare(b.name);
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
    .map((key) => item(key, sel.cityMap.value[key] ?? [], sel.lowestPingForCity(key), false));
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
    .map(([code, nodes]) => item(code, nodes as Node[], sel.getLowestPingForCountry(nodes as Node[]), false));
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
    .map((node) => item(node, sel.getLowestPingForNode(node.name), false));
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
    .filter((c) => !c.locked && available(c) && (main.sel.cityMap.value[c.key] ?? []).some(main.sel.autoPickable))
    .sort((a, b) => byMs(a.ms, b.ms)),
);
/** Global's ping: the best open city's. */
const fastest = computed(() =>
  cities.value.filter((c) => !c.locked && available(c)).reduce<Item | null>((b, c) => (!b || c.ms < b.ms ? c : b), null),
);

// ---- picking ----

/** Dedicated IP: a choice of its own in the picker, for the profile it
 * edits (the game's, or a row's). On, it is what that profile uses (the
 * relay goes toward the WireGuard server); any other choice applied turns
 * it off. */
const editedWireGuard = computed(() => useProfileWireGuard(main.profile.id));
const wireguard = computed(() => editedWireGuard.value.summary.value);
const wireguardPicked = computed(() => editedWireGuard.value.selected.value);
const setWireGuard = (on: boolean) => editedWireGuard.value.setEnabled(on);
const reloadWireGuard = () => editedWireGuard.value.reload();
/** The tunnel follows the profile's place again: the place is saved (on
 * the title for the game), so the profile claims its tunnel (the core
 * moves it when the relay that place picks is not the one in use). */
async function followTunnel(wg = editedWireGuard.value) {
  if (wg.summary.value.enabled && wg.selected.value) await wg.setEnabled(true);
}
/** A config picked on the page: Dedicated IP with that one, on Apply. */
function onConfigPicked(id: string) {
  draft.value.dedicated = true;
  draft.value.wgConfig = id;
}
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
  } else {
    const st = store.profileStates[login.profile.id];
    if (!st) return;
    st.node_id = null;
    st.mode = M.RoutingMode_ROUTING_MODE_GLOBAL;
    await store.saveProfileState(login.profile.id);
  }
  if (on) await syncLoginWireGuard();
}

/** Login connections that follow the title's place take its Dedicated IP
 * too, the same config (they connect first: without it the game's account
 * is seen from the user's own IP), and lose it with it. Only when it is
 * changed here (the title's choice): turned off on one row on its own, it
 * stays off. The game's region keeps picking the tunnel's relay. */
const loginWireGuard = login ? useProfileWireGuard(login.profile.id) : null;
let wireGuardSync: Promise<void> = Promise.resolve();
function syncLoginWireGuard(): Promise<void> {
  const run = async () => {
    if (!login || !loginWireGuard || !loginFollows.value) return;
    const want = dedicatedOn.value && loginFollows.value ? wireguard.value.selected : "";
    const own = loginWireGuard.summary.value;
    if (want === (own.enabled ? own.selected : "")) return;
    try {
      if (want) {
        await SelectProfileWireGuard(login.profile.id, want);
        // The game's profile owns the tunnel again (its region, its relay).
        await setWireGuard(true);
      } else {
        await loginWireGuard.setEnabled(false);
      }
    } catch {
      // service not running; the watch tries again on the next change
    }
    await loginWireGuard.reload();
  };
  // One at a time: the watch and an Apply may both ask.
  wireGuardSync = wireGuardSync.then(run, run);
  return wireGuardSync;
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
    if (wireGuardOff) {
      await setWireGuard(false);
      await syncLoginWireGuard();
    }
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
/** The quick pick's Top: the five open cities with the lowest ping (the
 * list stays short; the rest are in the picker). */
const quickCities = computed(() =>
  cities.value
    .filter((c) => !c.locked && available(c))
    .sort((a, b) => byMs(a.ms, b.ms))
    .slice(0, 5),
);
/** Dedicated IP configs picked lately on this PC, newest first. */
const recentConfigs = useLocalStorage<string[]>("lz-recent-wireguard", []);
function noteRecentConfig(configId: string) {
  recentConfigs.value = [configId, ...recentConfigs.value.filter((x) => x !== configId)].slice(0, 5);
}
/** The quick pick's Dedicated IP configs: the one in use, then the ones
 * picked lately, then any other profile uses; up to three. */
const quickConfigs = computed(() => {
  const configs = wireguard.value.configs;
  const order = [
    ...(dedicatedOn.value ? [wireguard.value.selected] : []),
    ...recentConfigs.value,
    ...configs.filter((c) => c.profiles.length).map((c) => c.id),
    ...configs.map((c) => c.id),
  ];
  const seen = new Set<string>();
  const list: typeof configs = [];
  for (const id of order) {
    const config = configs.find((c) => c.id === id);
    if (!config || seen.has(id)) continue;
    seen.add(id);
    list.push(config);
    if (list.length === 3) break;
  }
  return list;
});
/** The quick pick of a Dedicated IP config: on with it, right away. */
function quickPickConfig(configId: string) {
  quickOpen.value = false;
  noteRecentConfig(configId);
  if (dedicatedOn.value && wireguard.value.selected === configId) return;
  const before = oldRegionTcp();
  const id = main.profile.id;
  const wg = editedWireGuard.value;
  const primaryEdit = editingPrimary.value;
  applying = (async () => {
    await SelectProfileWireGuard(id, configId);
    await wg.reload();
    if (primaryEdit) await syncLoginWireGuard();
  })();
  if (before.ids.length) askFor({ leaving: false, old: before, quick: true });
}

/** The picker's choice, kept apart until Apply. */
type Draft = {
  mode: Mode;
  regions: string[];
  countries: string[];
  cities: string[];
  node: string | null;
  adapter: string;
  dedicated: boolean;
  /** Dedicated IP's config. */
  wgConfig: string;
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
    wgConfig: wireguard.value.selected ?? "",
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
  if (draft.value.wgConfig) draft.value.dedicated = true;
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
  // Dedicated IP of the profile edited: taken now, as closing goes back to
  // the game's profile.
  const primaryEdit = editingPrimary.value;
  const wg = editedWireGuard.value;
  // Dedicated IP on with another config (or turned on), or turned off.
  const useConfig =
    d.dedicated && !!d.wgConfig && (!dedicatedOn.value || d.wgConfig !== wg.summary.value.selected) ? d.wgConfig : "";
  const turnOff = !d.dedicated && dedicatedOn.value;
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
    if (useConfig) {
      noteRecentConfig(useConfig);
      await SelectProfileWireGuard(id, useConfig);
      await wg.reload();
    } else if (turnOff) {
      await wg.setEnabled(false);
    }
    // Dedicated IP turned on or off, or applied again: the login
    // connections take it too.
    if (primaryEdit && (useConfig || turnOff || d.dedicated)) await syncLoginWireGuard();
    // Still on, maybe somewhere else now: the tunnel follows the new place.
    if (!useConfig && d.dedicated) await followTunnel(wg);
  })();
}

// ---- the picker page ----

const placesOpen = ref(false);
/** The page shows only the picker meanwhile. */
const emit = defineEmits<{ picking: [boolean] }>();
// The page's title bar has the picker's Back, and says what it sets: the
// whole game's Location, or one profile's name.
const editingLabel = computed(() =>
  editingPrimary.value ? t("$vuetify.title.profile.location") : String(store.localized(main.profile.name) || ""),
);
defineExpose({ closePlaces: () => closePlaces(), openFor, editingLabel });
watch(placesOpen, (open) => emit("picking", open));
/** The internets menu on the picker's card. */
const internetsOpen = ref(false);
const wgPanel = ref<{ addFile: (file: File) => Promise<void>; refresh: () => void; expectMove: () => void } | null>(
  null,
);
/** Dedicated IP: a WireGuard config file dropped anywhere on its card is
 * added. The drag is handled here, not passed up: the app's runtime
 * otherwise marks every file drag "no drop". */
const configOver = ref(false);
let configDepth = 0;
function isFileDrag(event: DragEvent) {
  return tab.value === "dedicated" && !!event.dataTransfer?.types.includes("Files");
}
function onConfigDragEnter(event: DragEvent) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  configDepth++;
  configOver.value = true;
}
function onConfigDragOver(event: DragEvent) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
}
function onConfigDragLeave(event: DragEvent) {
  if (!isFileDrag(event)) return;
  configDepth = Math.max(0, configDepth - 1);
  if (!configDepth) configOver.value = false;
}
async function onConfigDrop(event: DragEvent) {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.stopPropagation();
  configDepth = 0;
  configOver.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) await wgPanel.value?.addFile(file);
}
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
]);
/** Slides: forward into the picker and down the modes, back out of it. */
const slide = ref<"fwd" | "back">("fwd");
function openPlaces() {
  draft.value = currentChoice();
  draftFrom.value = JSON.stringify(draft.value);
  tab.value = inUse.value;
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
      return { icon: node?.country ? "" : "mdi-server-outline", country: node?.country ?? "", label: node ? serverLabel(node) : t("$vuetify.title.profile.server.pickServer") };
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

/** Whether the chosen place can connect now: "available" (a server there
 * answered), "unavailable" (none can), "" while it is being checked, or
 * for Direct and a Dedicated IP. */
const selectedAvailability = computed<"" | "available" | "unavailable">(() => {
  if (mode.value === "direct" || dedicatedOn.value) return "";
  if (selectedMs.value) return "available";
  if (store.optimizing) return "";
  return "unavailable";
});

// ---- the rest of the page ----

/** The card is the title's: it shows the profile in use, by kind (the
 * game's first, then downloads, then voice and other multi-path ones, then
 * the rest), else the main one; the next one in use shows under it. */
/** Downloads and updates: High traffic, and not a call, a game or an app
 * kept connected (Discord's voice is High traffic too, but a call). */
function isDownloadKind(p: Profile): boolean {
  return (
    (p.flags & ProfileFlag.HIGH_TRAFFIC) !== 0 &&
    (p.flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET | ProfileFlag.PREVENT_DISCONNECT)) === 0
  );
}
function kindRank(p: Profile): number {
  if ((p.flags & ProfileFlag.GAME_PACKET) !== 0) return 0;
  if (isDownloadKind(p)) return 1;
  if ((p.flags & ProfileFlag.MULTIPATH) !== 0) return 2;
  return 3;
}
/** A download really going: a High traffic profile's idle connection (one
 * left open after an update) does not take the card. It keeps the card a
 * while after the speed drops, so a pause does not make it flicker. */
const DOWNLOADING_BPS = 64 * 1024;
const DOWNLOAD_HOLD_MS = 30_000;
const lastDownloading = reactive<Record<string, number>>({});
/** Voice and other multi-path profiles: last seen moving any data, held the
 * same while so a quiet moment in a call does not drop it. */
const lastTalking = reactive<Record<string, number>>({});
/** The title's profiles, read live: the list can still be filling in when
 * the page opens, and a profile picked for the card must be found once it
 * is there. */
const candidates = computed(() =>
  [...(props.allProfiles?.length ? props.allProfiles : props.profiles)].sort(
    (a, b) => kindRank(a) - kindRank(b) || (a.order ?? 0) - (b.order ?? 0),
  ),
);
/** Each profile's live connections, made once per profile in the page's
 * own scope (stopped with it). */
const pageScope = getCurrentScope();
const statsById = new Map<string, ReturnType<typeof useProfileConnectionStats>>();
function statsOf(p: Profile) {
  let stats = statsById.get(p.id);
  if (!stats) {
    stats = pageScope!.run(() => {
      const made = useProfileConnectionStats(() => p.id);
      // A download going: noted, for the hold below.
      if (isDownloadKind(p)) {
        watch(made.downloadSpeed, (bps) => {
          if (bps >= DOWNLOADING_BPS) lastDownloading[p.id] = Date.now();
        });
      }
      // A call going: any data moving, noted the same.
      if ((p.flags & ProfileFlag.MULTIPATH) !== 0) {
        watch(
          () => made.downloadSpeed.value + made.uploadSpeed.value,
          (bps) => {
            if (bps > 0) lastTalking[p.id] = Date.now();
          },
          { immediate: true },
        );
      }
      return made;
    })!;
    statsById.set(p.id, stats);
  }
  return stats;
}
const candidateStats = computed(() => candidates.value.map((p) => ({ profile: p, stats: statsOf(p) })));
const now = useNow({ interval: 5_000 });
function cardWorthy(c: { profile: Profile; stats: ReturnType<typeof statsOf> }): boolean {
  if (!store.isProfileActive(c.profile.id) || !c.stats.connected.value) return false;
  if (!isDownloadKind(c.profile)) return true;
  if (c.stats.downloadSpeed.value >= DOWNLOADING_BPS) return true;
  return now.value.getTime() - (lastDownloading[c.profile.id] ?? 0) < DOWNLOAD_HOLD_MS;
}
const usedProfiles = computed(() => candidateStats.value.filter(cardWorthy).map((c) => c.profile));
/** The card by itself: the game's own profile while it is in use; else
 * downloads while one is really downloading; else a call (voice and video)
 * with data moving; else the main profile while it has connections; else
 * any other in use; else the main one. */
const autoShown = computed<Profile>(() => {
  const used = usedProfiles.value;
  const isUsed = (id: string) => used.some((p) => p.id === id);
  const mainId = primary.profile.id;
  const mainIsGame = (primary.profile.flags & ProfileFlag.GAME_PACKET) !== 0;
  if (mainIsGame && isUsed(mainId)) return primary.profile;
  const downloading = used.find(isDownloadKind);
  if (downloading) return downloading;
  // A call (voice and video) with data moving comes before the main one.
  const talking = used.find(
    (p) =>
      p.id !== mainId &&
      (p.flags & ProfileFlag.MULTIPATH) !== 0 &&
      now.value.getTime() - (lastTalking[p.id] ?? 0) < DOWNLOAD_HOLD_MS,
  );
  if (talking) return talking;
  if (isUsed(mainId)) return primary.profile;
  return used[0] ?? primary.profile;
});
/** A profile picked for the card by hand, while the page stays open:
 * leaving the game turns "Switch to what's in use" back on. Empty: the card
 * follows what is in use. */
const pinnedShown = ref("");
const pinnedProfile = computed(() => candidates.value.find((p) => p.id === pinnedShown.value) ?? null);
const shown = computed<Profile>(() => pinnedProfile.value ?? autoShown.value);
const profileName = (p: Profile) => String(store.localized(p.name) || "");
/** The profiles as the page lists them (Advanced): the main one first,
 * then the rest in their order. */
const listedProfiles = computed(() =>
  [...candidates.value].sort(
    (a, b) =>
      Number(b.id === primary.profile.id) - Number(a.id === primary.profile.id) || (a.order ?? 0) - (b.order ?? 0),
  ),
);
/** A row of the card's menu: in use (taking the card when it switches by
 * itself), idle (on, nothing going) or off. */
function cardStatus(p: Profile): string {
  const c = candidateStats.value.find((x) => x.profile.id === p.id);
  if (!c || !store.isProfileActive(p.id)) return t("$vuetify.title.profile.statusOff");
  return cardWorthy(c) ? t("$vuetify.title.playFrom.cardInUse") : t("$vuetify.title.playFrom.cardIdle");
}
/** The card's profile menu. */
const cardMenuOpen = ref(false);
/** Profiles off while the game is on: said above the card (until "I'm
 * aware", remembered on this PC until the profile is on again). */
const offAware = useLocalStorage<string[]>("lz-profile-off-aware", []);
const offProfiles = computed(() =>
  store.isTitleActive(titleId) ? listedProfiles.value.filter((p) => !store.isProfileActive(p.id)) : [],
);
watch(
  () => listedProfiles.value.filter((p) => store.isProfileActive(p.id)).map((p) => p.id),
  (on) => {
    if (on.some((id) => offAware.value.includes(id))) offAware.value = offAware.value.filter((id) => !on.includes(id));
  },
  { immediate: true },
);
const offShown = computed(() => offProfiles.value.filter((p) => !offAware.value.includes(p.id)));
const offText = computed(() => {
  const list = offShown.value;
  if (!list.length) return "";
  const names = new Intl.ListFormat(currentLocale.value, { type: "conjunction" }).format(list.map(profileName));
  return list.length === 1 ? t("$vuetify.title.playFrom.profileOff", [names]) : t("$vuetify.title.playFrom.profilesOff", [names]);
});
const turningOn = ref(false);
async function turnOffProfilesOn() {
  turningOn.value = true;
  try {
    for (const p of offShown.value) await setProfileOn(p, true);
  } finally {
    turningOn.value = false;
  }
}
function beAware() {
  offAware.value = [...new Set([...offAware.value, ...offShown.value.map((p) => p.id)])];
}
/** This game's connections refused: no server could carry them. Said here,
 * on its own page (the page banner stays out of it), with Change Location
 * when one is set. */
const { rejection, dismiss: dismissRejection } = useConnectionRejected();
const rejectedHere = computed(() => {
  const r = rejection.value;
  if (!r) return null;
  return r.title_id === titleId || listedProfiles.value.some((p) => p.id === r.profile_id) ? r : null;
});
const rejectedProfile = computed(() => listedProfiles.value.find((p) => p.id === rejectedHere.value?.profile_id) ?? null);
const rejectedTitle = computed(() =>
  rejectedProfile.value
    ? t("$vuetify.title.playFrom.rejected", [profileName(rejectedProfile.value)])
    : t("$vuetify.title.playFrom.rejectedAny"),
);
const rejectedReason = computed(() => {
  const r = rejectedHere.value;
  if (!r) return "";
  if (r.code === "no_route") {
    return r.selection ? t("$vuetify.connectionRejected.noRouteIn", [r.selection]) : t("$vuetify.connectionRejected.noRoute");
  }
  return r.selection ? t("$vuetify.connectionRejected.noServerIn", [r.selection]) : t("$vuetify.connectionRejected.noServer");
});
function changeRejectedLocation() {
  const p = rejectedProfile.value;
  dismissRejection();
  if (p) openLocationFor(p);
  else quickOpen.value = true;
}
/** A profile's options (the Advanced row's ⋮), from its card's chevron or a
 * right-click on it. */
const optionsFor = ref<Profile | null>(null);
const optionsTarget = ref<Element | [number, number] | undefined>(undefined);
const optionsOpen = ref(false);
function openOptions(p: Profile, target: Element | [number, number]) {
  optionsFor.value = p;
  optionsTarget.value = target;
  optionsOpen.value = true;
}
const isAdmin = computed(() => plan.admin.value);
const { settings: appSettings } = useSettings();
const { rateProfile } = useSessionRating();
const canRateFor = (p: Profile) => appSettings.value.allowSendAnonymousData === true && store.isProfileActive(p.id);
const hasLocation = (p: Profile) => picks.some((x) => x.profile.id === p.id);
async function setProfileOn(p: Profile, on: boolean) {
  if (!store.appReady || on === store.isProfileActive(p.id)) return;
  if (on) await store.activateProfile(p.id);
  else await store.deactivateProfile(p.id);
}
function closeCardMenus() {
  optionsOpen.value = false;
  cardMenuOpen.value = false;
}
function openLocationFor(p: Profile) {
  closeCardMenus();
  openFor(p.id);
}
/** Route Settings opened for this profile (else the card's). */
const routeOpenFor = ref("");
function openSettingsFor(p: Profile) {
  closeCardMenus();
  routeOpenFor.value = p.id;
  routeSettingsOpen.value = true;
}
const reportFor = ref<Profile | null>(null);
const reportOpen = ref(false);
const logFor = ref<Profile | null>(null);
const logOpen = ref(false);
/** "Switch to what's in use": on unless a profile was picked by hand. */
const cardFollows = computed({
  get: () => !pinnedProfile.value,
  set: (on: boolean) => {
    pinnedShown.value = on ? "" : shown.value.id;
  },
});
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
/** Its profile chips: the title's routed profiles; it opens on the card's. */
const routeProfiles = computed(() => listedProfiles.value.filter((p) => p.route_action === "route" || p.id === shown.value.id));
const routeProfileId = ref("");
/** A profile picked for the card, not the main one: its own location is
 * in the panel too (the Server button is the game's). */
const pinnedOther = computed(() =>
  pinnedProfile.value && pinnedProfile.value.id !== primary.profile.id && picks.some((x) => x.profile.id === pinnedProfile.value!.id)
    ? pinnedProfile.value
    : null,
);
/** Where a profile plays from: its Dedicated IP, else its location (the
 * game's, unless it has its own). */
type Place = { country: string; icon: string; label: string };
function placeOf(p: Profile): Place {
  const wg = useProfileWireGuard(p.id);
  if (wg.summary.value.enabled && wg.selected.value) {
    const c = wg.selected.value;
    return { country: c.country ?? "", icon: "mdi-tunnel-outline", label: c.name || t("$vuetify.title.profile.wireguard.title") };
  }
  const st = store.profileStates[p.id];
  const sel = picks.find((x) => x.profile.id === p.id)?.sel ?? main.sel;
  const more = (n: number) => (n > 1 ? ` +${localDigits(n - 1)}` : "");
  switch (modeOf(st)) {
    case "region": {
      const list = st?.regions ?? [];
      return { country: "", icon: "mdi-earth", label: `${list[0] ? sel.getRegionLocalizedName(list[0]) : ""}${more(list.length)}` };
    }
    case "country": {
      const list = st?.countries ?? [];
      return { country: list[0] ?? "", icon: "mdi-earth", label: `${countryName(list[0] ?? "") || list[0] || ""}${more(list.length)}` };
    }
    case "city": {
      const list = st?.cities ?? [];
      const city = list[0] ? cityGroupMap.value.get(list[0]) : undefined;
      return {
        country: city?.[0]?.country ?? "",
        icon: "mdi-city-variant-outline",
        label: `${list[0] ? sel.getCityLabel(list[0]) : ""}${more(list.length)}`,
      };
    }
    case "server": {
      const node = st?.node_id ? store.nodes[st.node_id] : undefined;
      return { country: node?.country ?? "", icon: "mdi-server-outline", label: node ? serverLabel(node) : t("$vuetify.title.profile.server.pickServer") };
    }
    case "direct":
      return { country: "", icon: "mdi-call-split", label: t("$vuetify.title.profile.server.directWithoutServer") };
    default:
      return { country: "", icon: "mdi-lightning-bolt", label: t("$vuetify.title.profile.server.automatic") };
  }
}
/** Each listed profile's place, for the card's menu and its pill. */
const places = computed<Record<string, Place>>(() => Object.fromEntries(listedProfiles.value.map((p) => [p.id, placeOf(p)])));
/** The pinned profile's place, for the panel's Location row. */
const pinnedPlace = computed(() => (pinnedOther.value ? placeOf(pinnedOther.value) : null));
/** A profile's icon in the card's menu: what it carries. */
function kindIcon(p: Profile): string {
  if ((p.flags & ProfileFlag.GAME_PACKET) !== 0) return "mdi-gamepad-variant-outline";
  if ((p.flags & ProfileFlag.MULTIPATH) !== 0) return "mdi-headset";
  if (isDownloadKind(p)) return "mdi-download-outline";
  return "mdi-earth";
}
/** In use, idle or off: the dot's look. */
function cardStatusKind(p: Profile): "on" | "idle" | "off" {
  const c = candidateStats.value.find((x) => x.profile.id === p.id);
  if (!c || !store.isProfileActive(p.id)) return "off";
  return cardWorthy(c) ? "on" : "idle";
}
/** Settings for downloads (a load-balancing profile): their internets,
 * load balancing included, at the top. */
const routeBalance = computed(() => {
  const p = routeProfile.value;
  const pick = picks.find((x) => x.profile.id === p.id);
  return isDownloadKind(p) && p.route_action === "route" && pick ? pick : null;
});
function changePinnedLocation() {
  const p = pinnedOther.value;
  if (!p) return;
  routeSettingsOpen.value = false;
  openFor(p.id);
}
const { profileOverrides, profileOverrideKinds, overridesText } = useRouteOverrides();
/** Some profile on the Settings panel sets its own: a dot on the button. */
const routeOverridden = computed(() =>
  routeProfiles.value.some((p) => profileOverrides(p, p.id === primary.profile.id)),
);
const routeOverridesText = computed(() =>
  overridesText(routeProfiles.value.flatMap((p) => profileOverrideKinds(p, p.id === primary.profile.id))),
);
const routeProfile = computed<Profile>(() => routeProfiles.value.find((p) => p.id === routeProfileId.value) ?? shown.value);
watch(routeSettingsOpen, (open) => {
  if (!open) return;
  routeProfileId.value = routeOpenFor.value || shown.value.id;
  routeOpenFor.value = "";
});

// A title's right-click menu asked for its location (the picker) or its
// settings (Settings); Bandwidth Control for a profile's settings or its
// download cap (the card shows that profile, its cap button opens it).
const titleMenu = useTitleMenu();
onMounted(() => {
  if (titleMenu.take(titleId, "location")) openPlaces();
});
watch(
  () => [titleMenu.pending.titleId, titleMenu.pending.what, titleMenu.pendingProfile.profileId, titleMenu.pendingProfile.what] as const,
  () => {
    if (titleMenu.take(titleId, "settings")) {
      setTimeout(() => (routeSettingsOpen.value = true), 150);
      return;
    }
    const id = titleMenu.pendingProfile.profileId;
    if (!id || !candidates.value.some((p) => p.id === id)) return;
    if (titleMenu.pendingProfile.what === "cap") {
      // Its cap button is on the card once the card shows it.
      pinnedShown.value = id;
      return;
    }
    if (titleMenu.takeProfile(id, "settings")) {
      routeOpenFor.value = id;
      setTimeout(() => (routeSettingsOpen.value = true), 150);
    }
  },
  { immediate: true },
);
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
        <v-card variant="flat" rounded="lg" class="pick-page__side title-outlined">
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
        <v-card
          variant="flat"
          rounded="lg"
          class="pick-page__main title-outlined"
          :class="{ 'pick-page__main--drop': configOver }"
          @dragenter="onConfigDragEnter"
          @dragover="onConfigDragOver"
          @dragleave="onConfigDragLeave"
          @drop="onConfigDrop"
        >
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
              <ProfileWireGuard
                ref="wgPanel"
                panel
                :profile-id="main.profile.id"
                :draft-id="draft.wgConfig"
                :disabled="!store.appReady"
                @picked="onConfigPicked"
              />
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
                    <span class="pick-tile__name"><span class="pick-tile__label"><span class="pick-tile__head">{{ labelParts(item.label).head }}</span><span v-if="labelParts(item.label).num" class="pick-tile__num">{{ labelParts(item.label).num }}</span></span></span>
                    <Ping v-if="available(item)" :tag="item.tag" :latency-ms="item.ms" />
                    <span v-else class="pick-tile__unavailable">{{ t("$vuetify.title.playFrom.unavailable") }}</span>
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
                      <span class="pick-tile__label"><span class="pick-tile__head">{{ labelParts(item.label).head }}</span><span v-if="labelParts(item.label).num" class="pick-tile__num">{{ labelParts(item.label).num }}</span></span>
                      <span v-if="item.sub" class="pick-tile__sub">{{ item.sub }}</span>
                    </span>
                    <v-icon v-if="item.locked" icon="mdi-cart-outline" size="16" color="amber" />
                    <Ping v-else-if="available(item)" :tag="item.tag" :latency-ms="item.ms" />
                    <span v-else class="pick-tile__unavailable">{{ t("$vuetify.title.playFrom.unavailable") }}</span>
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
        <!-- Where the game connects from, a small card labelled
             Location. Hover: the quick pick (Automatic, a top city or a
             recent Dedicated IP config); click: the picker. -->
        <!-- Hover or click: the quick pick; double-click: the picker. -->
        <v-menu
          v-model="quickOpen"
          open-on-hover
          :open-on-click="false"
          :open-delay="0"
          :close-delay="150"
          location="bottom start"
          :offset="8"
        >
          <template #activator="{ props: menuProps }">
            <v-card
              v-bind="menuProps"
              variant="flat"
              rounded="lg"
              class="play-from__loc flex-grow-0"
              @click="quickOpen = true"
              @dblclick="quickOpen = false; openPlaces()"
            >
              <div class="d-flex align-center ga-4 ps-4 pe-2 py-2">
                <div style="min-width: 0">
                  <div class="text-caption text-medium-emphasis">{{ t("$vuetify.title.playFrom.changeLocation") }}</div>
                  <div class="d-flex align-center text-no-wrap">
                    <FlagImg v-if="selected.country" :country="selected.country" :height="14" class="me-2" />
                    <v-icon v-else :icon="selected.icon" size="18" class="me-2" />
                    <span class="font-weight-medium text-truncate">{{ selected.label }}</span>
                    <!-- Can it connect now: a dot, and a word when it cannot. -->
                    <span
                      v-if="selectedAvailability"
                      v-tooltip:top="t(`$vuetify.title.playFrom.${selectedAvailability}Hint`)"
                      class="play-from__avail d-inline-flex align-center ms-2"
                      :class="`play-from__avail--${selectedAvailability}`"
                    >
                      <span class="play-from__avail-dot" />
                      <span v-if="selectedAvailability === 'unavailable'" class="text-caption ms-1">
                        {{ t("$vuetify.title.playFrom.unavailable") }}
                      </span>
                    </span>
                    <Ping v-if="selectedMs" :latency-ms="selectedMs" class="ms-3" />
                  </div>
                </div>
                <!-- Down while its quick pick is open. -->
                <v-icon
                  icon="mdi-chevron-right"
                  class="play-from__loc-chevron ms-auto text-medium-emphasis"
                  :class="{ 'play-from__loc-chevron--open': quickOpen }"
                />
              </div>
            </v-card>
          </template>
          <v-card min-width="260" max-width="340">
            <v-list density="compact" class="py-1">
              <v-list-item
                :active="!dedicatedOn && mode === 'global'"
                prepend-icon="mdi-lightning-bolt"
                :title="t('$vuetify.title.profile.server.automatic')"
                @click="quickPick('')"
              >
                <!-- Automatic takes the best place: said, not a ping. -->
                <template #append>
                  <span class="text-caption text-medium-emphasis">{{ t("$vuetify.title.playFrom.quickBest") }}</span>
                </template>
              </v-list-item>
              <v-list-subheader v-if="quickCities.length">{{ t("$vuetify.title.playFrom.quickTop") }}</v-list-subheader>
              <v-list-item
                v-for="city in quickCities"
                :key="city.key"
                :active="!dedicatedOn && mode === 'city' && (state?.cities ?? []).length === 1 && state?.cities?.[0] === city.key"
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
            <template v-if="quickConfigs.length">
              <v-divider />
              <v-list density="compact" class="py-1">
                <v-list-subheader>{{ t("$vuetify.title.profile.wireguard.title") }}</v-list-subheader>
                <v-list-item
                  v-for="config in quickConfigs"
                  :key="config.id"
                  :active="dedicatedOn && wireguard.selected === config.id"
                  @click="quickPickConfig(config.id)"
                >
                  <template #prepend>
                    <FlagImg v-if="config.country" :country="config.country" :height="14" class="me-3" />
                    <v-icon v-else icon="mdi-tunnel-outline" size="18" class="me-3" />
                  </template>
                  <v-list-item-title>{{ config.name }}</v-list-item-title>
                  <template v-if="dedicatedOn && wireguard.selected === config.id && editedWireGuard.status.value.ping > 0" #append>
                    <Ping :latency-ms="editedWireGuard.status.value.ping" />
                  </template>
                </v-list-item>
              </v-list>
            </template>
            <v-divider />
            <v-list density="compact" class="py-1">
              <v-list-item
                prepend-icon="mdi-tune-variant"
                append-icon="mdi-chevron-right"
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

      <!-- A profile off while the game is on: said here, with Turn on. -->
      <v-expand-transition>
        <v-alert
          v-if="offShown.length"
          type="warning"
          variant="tonal"
          density="compact"
          rounded="lg"
          class="play-from__off"
        >
          <div class="d-flex align-center flex-wrap ga-2">
            <span class="flex-grow-1">{{ offText }}</span>
            <v-btn variant="text" color="on-surface" size="small" class="text-none" @click="beAware">
              {{ t("$vuetify.title.playFrom.offAware") }}
            </v-btn>
            <v-btn
              variant="tonal"
              color="on-surface"
              size="small"
              class="text-none"
              :loading="turningOn"
              :disabled="!store.appReady"
              @click="turnOffProfilesOn"
            >
              {{ t("$vuetify.title.playFrom.offTurnOn") }}
            </v-btn>
          </div>
        </v-alert>
      </v-expand-transition>
      <!-- Its connections refused: no server could carry them. -->
      <v-expand-transition>
        <v-alert
          v-if="rejectedHere"
          type="error"
          variant="tonal"
          density="compact"
          rounded="lg"
          class="play-from__off"
        >
          <div class="d-flex align-center flex-wrap ga-2">
            <div class="flex-grow-1">
              <div class="font-weight-medium">{{ rejectedTitle }}</div>
              <div class="text-body-2">
                {{ rejectedReason }}
                <template v-if="rejectedHere.selection">{{ t("$vuetify.title.playFrom.rejectedTryLocation") }}</template>
              </div>
            </div>
            <v-btn variant="text" color="on-surface" size="small" class="text-none" @click="dismissRejection">
              {{ t("$vuetify.connectionRejected.close") }}
            </v-btn>
            <v-btn
              v-if="rejectedHere.selection"
              variant="tonal"
              color="on-surface"
              size="small"
              class="text-none"
              @click="changeRejectedLocation"
            >
              {{ t("$vuetify.title.playFrom.changeLocation") }}
            </v-btn>
          </div>
        </v-alert>
      </v-expand-transition>
      <!-- An internet one of its profiles uses is not connected: fix it here. -->
      <UnavailableInternetAlert :profiles="allProfiles ?? profiles" />
      <!-- How it goes: the game's own card, full width (its ping, route
           diagram, chart and hints). -->
      <div class="play-from title-outlined">
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
          <!-- Above the ping: which profile the card shows. -->
          <template #above>
          <!-- Which profile the card shows: Automatic (the one in use), or one
               picked by hand, which stays. -->
          <div v-if="candidates.length > 1" class="play-from__card-pick">
            <!-- The switch keeps it open; picking a profile closes it. -->
            <v-menu v-model="cardMenuOpen" location="bottom start" :close-on-content-click="false">
              <template #activator="{ props: menuProps }">
                <v-btn
                  v-bind="menuProps"
                  variant="text"
                  color="on-surface"
                  size="small"
                  class="text-none px-2"
                  append-icon="mdi-menu-down"
                >
                  <FlagImg v-if="places[shown.id]?.country" :country="places[shown.id]!.country" :height="12" class="me-2" />
                  {{ profileName(shown) }}
                </v-btn>
              </template>
              <v-card min-width="380" max-width="460" class="card-pick pa-2">
                <!-- Off once a profile is picked; on, the card goes to the
                     one in use by itself. -->
                <div class="d-flex align-center ga-3 ps-2">
                  <span class="text-body-2 flex-grow-1 d-flex align-center ga-1">
                    {{ t("$vuetify.title.playFrom.cardFollow") }}
                    <v-tooltip :text="t('$vuetify.title.playFrom.cardFollowHint')" location="top" max-width="280">
                      <template #activator="{ props: tipProps }">
                        <v-icon v-bind="tipProps" icon="mdi-help-circle-outline" size="16" class="text-medium-emphasis" />
                      </template>
                    </v-tooltip>
                  </span>
                  <v-checkbox-btn
                    :model-value="cardFollows"
                    density="compact"
                    class="flex-grow-0"
                    @update:model-value="cardFollows = !!$event"
                  />
                </div>
                <!-- A card per profile: what it carries, where it plays from
                     and whether it is in use. Picking one keeps the card on
                     it. -->
                <div class="d-flex flex-column ga-2 mt-1">
                  <v-card
                    v-for="p in listedProfiles"
                    :key="p.id"
                    variant="flat"
                    rounded="lg"
                    class="card-pick__item"
                    :class="{ 'card-pick__item--on': shown.id === p.id, 'card-pick__item--auto': shown.id === p.id && cardFollows }"
                    @click="pinnedShown = p.id; cardMenuOpen = false"
                    @contextmenu.prevent="openOptions(p, [$event.clientX, $event.clientY])"
                  >
                    <div class="d-flex align-center ga-3 pa-3">
                      <v-icon :icon="kindIcon(p)" size="20" class="text-medium-emphasis" />
                      <div class="flex-grow-1" style="min-width: 0">
                        <div class="text-body-2 font-weight-medium text-truncate">{{ profileName(p) }}</div>
                        <div class="d-flex align-center ga-1 text-caption text-medium-emphasis">
                          <FlagImg v-if="places[p.id]?.country" :country="places[p.id]!.country" :height="11" />
                          <v-icon v-else :icon="places[p.id]?.icon" size="13" />
                          <span class="text-truncate">{{ places[p.id]?.label }}</span>
                        </div>
                      </div>
                      <div class="d-flex align-center ga-1 text-caption text-no-wrap" :class="{ 'text-medium-emphasis': cardStatusKind(p) !== 'on' }">
                        <span class="card-pick__dot" :class="'card-pick__dot--' + cardStatusKind(p)" />
                        {{ cardStatus(p) }}
                      </div>
                      <!-- Clicking the card picks it; right-click has its
                           options. -->
                      <v-icon icon="mdi-chevron-right" size="20" class="text-medium-emphasis" />
                    </div>
                  </v-card>
                </div>
                <!-- A profile's options, beside its card. -->
                <v-menu v-model="optionsOpen" :target="optionsTarget" location="end top">
                  <v-list v-if="optionsFor" density="compact" min-width="230">
                    <v-list-item
                      prepend-icon="mdi-power"
                      :title="profileName(optionsFor)"
                      :subtitle="t(store.isProfileActive(optionsFor.id) ? '$vuetify.title.profile.statusOnShort' : '$vuetify.title.profile.statusOff')"
                      :disabled="!store.appReady"
                      @click="setProfileOn(optionsFor, !store.isProfileActive(optionsFor.id))"
                    >
                      <template #append>
                        <v-switch
                          :model-value="store.isProfileActive(optionsFor.id)"
                          inset
                          hide-details
                          density="compact"
                          :color="lagzapPaused && store.isProfileActive(optionsFor.id) ? 'warning' : 'cyan'"
                          class="ms-3"
                          @click.stop
                          @update:model-value="setProfileOn(optionsFor!, !!$event)"
                        >
                          <template v-if="lagzapPaused && store.isProfileActive(optionsFor.id)" #thumb>
                            <v-icon icon="mdi-pause" size="12" />
                          </template>
                        </v-switch>
                      </template>
                    </v-list-item>
                    <v-list-item
                      v-if="hasLocation(optionsFor)"
                      prepend-icon="mdi-map-marker-outline"
                      :title="t('$vuetify.title.profile.location')"
                      @click="openLocationFor(optionsFor)"
                    />
                    <v-list-item
                      prepend-icon="mdi-cog-outline"
                      :title="t('$vuetify.title.profile.settings')"
                      @click="openSettingsFor(optionsFor)"
                    />
                    <v-divider class="my-1" />
                    <v-list-item
                      v-if="canRateFor(optionsFor)"
                      prepend-icon="mdi-star-outline"
                      :title="t('$vuetify.sessionRating.rateButton')"
                      @click="rateProfile(optionsFor.id, optionsFor.title_id, t('$vuetify.sessionRating.noSession'))"
                    />
                    <v-list-item
                      prepend-icon="mdi-bug-outline"
                      :title="t('$vuetify.tickets.reportProblem')"
                      @click="reportFor = optionsFor; reportOpen = true; closeCardMenus()"
                    />
                    <v-list-item
                      v-if="isAdmin"
                      prepend-icon="mdi-console"
                      :title="t('$vuetify.consoleLog.open')"
                      @click="logFor = optionsFor; logOpen = true; closeCardMenus()"
                    />
                  </v-list>
                </v-menu>
              </v-card>
            </v-menu>
          </div>
          </template>
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
              <!-- Some of the game's settings differ from the global ones. -->
              <span
                v-if="routeOverridden"
                v-tooltip="routeOverridesText"
                class="play-from__override-dot me-2"
              />
              {{ pinnedOther ? t("$vuetify.title.playFrom.locationSettings") : t("$vuetify.title.profile.settings") }}
            </v-btn>
            <ProfileRouteSettings
              v-model:open="routeSettingsOpen"
              bare
              :target="routeBtn?.$el ?? null"
              :profile="routeProfile"
              :profiles="pinnedProfile ? undefined : routeProfiles"
              :edits-title="routeProfile.id === primary.profile.id"
              :title-profile-id="primary.profile.id"
              :hide-adapter="!!routeBalance"
              title-scope
              @pick="routeProfileId = $event"
            >
              <template v-if="pinnedPlace || routeBalance" #top>
                <!-- Downloads: load balancing over the internets. -->
                <div v-if="routeBalance" class="route-balance mb-3">
                  <ProfileInternetOptions
                    :key="routeBalance.profile.id"
                    :profile="routeBalance.profile"
                    :sel="routeBalance.sel"
                    :live="routeSettingsOpen"
                    no-dedicated-ip
                  />
                </div>
                <!-- A profile picked for the card: its own location. -->
                <div v-if="pinnedPlace" class="d-flex align-center ga-2 mb-2">
                  <div class="flex-grow-1" style="min-width: 0">
                    <div class="text-body-2">{{ t("$vuetify.title.profile.location") }}</div>
                    <div class="d-flex align-center text-caption text-medium-emphasis">
                      <FlagImg v-if="pinnedPlace.country" :country="pinnedPlace.country" :height="12" class="me-1" />
                      <span class="text-truncate">{{ pinnedPlace.label }}</span>
                    </div>
                  </div>
                  <v-btn variant="tonal" color="on-surface" size="small" class="text-none" @click="changePinnedLocation">
                    {{ t("$vuetify.connectionRejected.changeLocation") }}
                  </v-btn>
                </div>
              </template>
            </ProfileRouteSettings>
          </template>
        </ProfileCard>
      </div>
      <!-- The card's chart, on a card of its own under it (the card puts it
           here). -->
      <div :id="`play-from-chart-${titleId}`" class="play-from__chart title-outlined" />
      <!-- A profile's Report a problem and (admins) console, from its
           options in the card's menu. -->
      <DialogBugFeedback
        v-model="reportOpen"
        :subject="t('$vuetify.tickets.reportSubject', reportFor ? profileName(reportFor) : '')"
      />
      <AdminLogDialog
        v-if="isAdmin && logFor"
        v-model="logOpen"
        kind="profile"
        :id="logFor.id"
        :name="profileName(logFor)"
      />
      <!-- The game's connections, on a card of their own under it. -->
      <v-card v-if="connectionCount > 0" variant="flat" rounded="lg" class="play-from__conns title-outlined">
        <v-card-item>
          <v-card-title class="d-flex align-center ga-2 text-subtitle-1">
            {{ t("$vuetify.title.profile.connections") }}
            <span class="play-from__count">{{ localDigits(connectionCount) }}</span>
          </v-card-title>
        </v-card-item>
        <v-card-text class="pt-0">
          <!-- A connection clicked: its profile on the card above. -->
          <ProfileConnectionsTable
            :profile-id="main.profile.id"
            :profile-ids="titleProfileIds"
            :limit="5"
            @pick="(id) => candidates.some((p) => p.id === id) && (pinnedShown = id)"
          />
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
/* A WireGuard config dragged over the Dedicated IP card. */
.pick-page__main--drop {
  outline: 2px dashed rgb(var(--v-theme-primary));
  outline-offset: -2px;
  background: rgba(var(--v-theme-primary), 0.06);
}
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
  /* Clip, not hidden: hidden makes a scroll box of its own, and the
     picker's title row and sidebar could not stay in place. */
  overflow-x: clip;
}

/* Settings differ from the global ones: a small dot in the text's color. */
.play-from__override-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.75;
}

/* The page's cards: a thin outline, as on Network Status. */
.title-outlined {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
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

/* Not pulled out past the card's edge: the title clips anything outside. */
/* The Location card's chevron turns down while its quick pick is open. */
/* A place with no server that can connect now, instead of its ping. */
.pick-tile__unavailable {
  flex: none;
  font-size: 0.75rem;
  color: rgb(var(--v-theme-error));
}

/* Can the chosen place connect: green, or red with a word. */
.play-from__avail-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
}

.play-from__avail--available {
  color: rgb(var(--v-theme-success));
}

.play-from__avail--unavailable {
  color: rgb(var(--v-theme-error));
}

.play-from__loc-chevron {
  transition: transform 0.2s ease;
}

.play-from__loc-chevron--open {
  transform: rotate(90deg);
}

/* Right to left: mirrored (the app-wide rule), and turned down when open;
   specific enough to win over that rule. */
.v-locale--is-rtl .v-icon.play-from__loc-chevron.play-from__loc-chevron--open {
  transform: scaleX(-1) rotate(90deg);
}

/* The Location card: as wide as what it says; it opens the picker. */
.play-from__loc {
  min-width: 200px;
  max-width: 360px;
  background: rgb(var(--v-theme-surface-container-high));
}

/* Load balancing in Settings: its own block, edge to edge. */
.route-balance {
  margin-inline: -16px;
}

.play-from__card-pick {
  margin-inline-start: 0;
}

/* The card's profile menu: a card per profile. */
.card-pick__item {
  background: rgb(var(--v-theme-surface-container-high));
  border: 1px solid transparent;
}

.card-pick__item--on {
  border-color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Picked by itself (Switch to what's in use on): a dashed border. */
.card-pick__item--auto {
  border-style: dashed;
  border-width: 2px;
}

.card-pick__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.3);
}

.card-pick__dot--on {
  background: rgb(var(--v-theme-success));
}

.card-pick__dot--off {
  background: transparent;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.4);
}

.v-theme--light .play-from,
.v-theme--light .play-from__conns {
  background: rgb(var(--v-theme-background));
}

/* The chart's card: the same surface as the game's card above it. */
.play-from__chart {
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  padding-top: 12px;
}

.play-from__chart:not(:has(*)) {
  display: none;
}

.v-theme--light .play-from__chart {
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
/* The picker fills the page exactly: the page itself never scrolls, only
   the choices on the right do. */
.pick-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: calc(100vh - 100px);
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
  min-height: 0;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 12px;
  overflow: clip;
}

.pick-page__side {
  align-self: start;
  max-height: 100%;
  overflow-y: auto;
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
  min-height: 0;
  overflow-y: auto;
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

/* One line: the name is cut with "…", its number never (labelParts). */
.pick-tile__label {
  display: flex;
  min-width: 0;
  white-space: nowrap;
}
.pick-tile__head {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pick-tile__num {
  flex: none;
  margin-inline-start: 0.3em;
}
.pick-tile__row > :not(.pick-tile__name) {
  flex: none;
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
