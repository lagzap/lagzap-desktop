import { Events } from "@wailsio/runtime";
import {
  Gaming,
  GetAppInfo,
  SetAppLimits,
  SetAppRoutes,
  SetAppTrafficWatch,
  SetAppTunnels,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { AppLimitRule, AppRouteRule, AppTunnelRule, type AppTraffic } from "~/bindings/github.com/lagzap/lagzap/adapter";
import {
  listAppLimits,
  listAppRoutes,
  listAppTunnels,
  removeAppLimit,
  removeAppRoute,
  removeAppTunnel,
  saveAppLimit,
  saveAppRoute,
  saveAppTunnel,
  type AppLimit,
  type AppRoute,
  type AppTunnel,
} from "~/utils/indexedDB";

/** Seconds of download speed each app's sparkline shows. */
export const HISTORY_SECONDS = 60;

// Go counts and caps every app on the NDIS layer. This module keeps the caps
// (IndexedDB, this PC only), sends them to Go, and while the page is open
// holds the latest per-app snapshot and each app's last minute of speed.
const limits = ref<AppLimit[]>([]);
/** Apps and folders sent through another internet (Go moves their new
 * connections on the NDIS layer). */
const routes = ref<AppRoute[]>([]);
/** Apps, folders or the whole PC sent through a Dedicated IP (WireGuard):
 * Go captures them and routes them into the config's tunnel. */
const tunnels = ref<AppTunnel[]>([]);
const apps = shallowRef<AppTraffic[]>([]);
const history = new Map<string, number[]>();
/** Each app's last minute of speed per internet it arrived on (app key ->
 * internet name -> points). Starts when the page opens; Go keeps none. */
const internetHistory = new Map<string, Map<string, number[]>>();
const historyTick = ref(0);
const gaming = ref(false);
const running = ref(false);
const appInfo = reactive(new Map<string, { name: string; icon: string }>());

/** The clock the caps' "ends in" labels and expiry use, ticking every 30 s. */
export const nowMs = ref(Date.now());

const watcherId = crypto.randomUUID();
let watchers = 0;
let offPage: (() => void)[] = [];
let installed = false;

function pushLimits() {
  SetAppLimits(limits.value.map((limit) => new AppLimitRule(limit))).catch(() => {
    // service not running; "service-started" sends them again
  });
}

function pushRoutes() {
  SetAppRoutes(routes.value.map((route) => new AppRouteRule(route))).catch(() => {
    // service not running; "service-started" sends them again
  });
}

function pushTunnels() {
  SetAppTunnels(tunnels.value.map((tunnel) => new AppTunnelRule(tunnel))).catch(() => {
    // service not running; "service-started" sends them again
  });
}

async function loadTunnels() {
  try {
    tunnels.value = await listAppTunnels();
  } catch {
    tunnels.value = [];
  }
  pushTunnels();
}

export async function saveTunnel(tunnel: AppTunnel) {
  // One whole-PC rule: a new one replaces it.
  if (tunnel.kind === "pc") {
    for (const old of tunnels.value.filter((item) => item.kind === "pc" && item.id !== tunnel.id)) {
      await removeAppTunnel(old.id);
    }
    tunnels.value = tunnels.value.filter((item) => item.kind !== "pc" || item.id === tunnel.id);
  }
  await saveAppTunnel(tunnel);
  const index = tunnels.value.findIndex((item) => item.id === tunnel.id);
  if (index >= 0) tunnels.value.splice(index, 1, { ...tunnel });
  else tunnels.value.push({ ...tunnel });
  pushTunnels();
}

export async function deleteTunnel(id: string) {
  await removeAppTunnel(id);
  tunnels.value = tunnels.value.filter((item) => item.id !== id);
  pushTunnels();
}

/** The Dedicated IP rule for path's app: its own, else its deepest
 * folder's (as Go matches); the whole PC's is separate. */
export function tunnelFor(path: string): AppTunnel | null {
  const key = pathKey(path);
  let best: AppTunnel | null = null;
  for (const tunnel of tunnels.value) {
    if (tunnel.kind === "pc") continue;
    const rule = pathKey(tunnel.path);
    if (tunnel.kind === "exe" && rule === key) return tunnel;
    if (tunnel.kind === "folder" && key.startsWith(rule + "\\") && (!best || rule.length > pathKey(best.path).length)) {
      best = tunnel;
    }
  }
  return best;
}

async function loadRoutes() {
  try {
    routes.value = await listAppRoutes();
  } catch {
    routes.value = [];
  }
  pushRoutes();
}

export async function saveRoute(route: AppRoute) {
  await saveAppRoute(route);
  const index = routes.value.findIndex((item) => item.id === route.id);
  if (index >= 0) routes.value.splice(index, 1, { ...route });
  else routes.value.push({ ...route });
  pushRoutes();
}

export async function deleteRoute(id: string) {
  await removeAppRoute(id);
  routes.value = routes.value.filter((item) => item.id !== id);
  pushRoutes();
}

/** The rule sending path's app through another internet: its own, else its
 * deepest folder's (as Go matches). */
/** Windows paths compared as Go does: case and slash direction do not
 * matter, a folder's trailing backslash is dropped. */
function pathKey(path: string) {
  return path.toLowerCase().replace(/\//g, "\\").replace(/\\+$/, "");
}

export function routeFor(path: string): AppRoute | null {
  const key = pathKey(path);
  let best: AppRoute | null = null;
  for (const route of routes.value) {
    const rule = pathKey(route.path);
    if (route.kind === "exe" && rule === key) return route;
    if (route.kind === "folder" && key.startsWith(rule + "\\") && (!best || rule.length > pathKey(best.path).length)) {
      best = route;
    }
  }
  return best;
}

const expired = (limit: AppLimit, now = nowMs.value) => !!limit.expires_at && now >= limit.expires_at;

/** Deletes caps whose time is up (Go already stopped applying them). */
async function dropExpired() {
  nowMs.value = Date.now();
  const gone = limits.value.filter((limit) => expired(limit));
  if (!gone.length) return;
  await Promise.all(gone.map((limit) => removeAppLimit(limit.id).catch(() => {})));
  limits.value = limits.value.filter((limit) => !gone.includes(limit));
  pushLimits();
}

async function loadLimits() {
  try {
    const stored = await listAppLimits();
    // LagZap just started: caps kept "until restart" end here.
    const gone = stored.filter((limit) => limit.until_restart || expired(limit, Date.now()));
    await Promise.all(gone.map((limit) => removeAppLimit(limit.id).catch(() => {})));
    limits.value = stored.filter((limit) => !gone.includes(limit));
  } catch {
    limits.value = [];
  }
  pushLimits();
}

/** Once, from the layout: Go gets the caps on every service start, so they
 * apply with the page closed too. */
export function installBandwidthLimits() {
  if (installed) return;
  installed = true;
  loadLimits();
  loadRoutes();
  loadTunnels();
  setInterval(dropExpired, 30_000);
  Events.On("service-started", () => {
    pushLimits();
    pushRoutes();
    pushTunnels();
  });
  Events.On("gaming-state", ({ data }: any) => {
    gaming.value = Boolean(Array.isArray(data) ? data[0] : data);
  });
  Gaming()
    .then((value) => (gaming.value = value))
    .catch(() => {});
}

function keyOf(path: string) {
  return path.toLowerCase();
}

function remember(list: AppTraffic[], withHistory: boolean) {
  const seen = new Set<string>();
  for (const app of list) {
    const key = keyOf(app.path);
    seen.add(key);
    let points = history.get(key);
    if (withHistory && app.history?.length) {
      points = app.history.slice(-HISTORY_SECONDS);
    } else {
      points = [...(points ?? new Array(HISTORY_SECONDS).fill(0)), app.download_speed];
      if (points.length > HISTORY_SECONDS) points = points.slice(-HISTORY_SECONDS);
    }
    history.set(key, points);

    const byInternet = internetHistory.get(key) ?? new Map<string, number[]>();
    const now = new Map((app.internets ?? []).map((item) => [item.name, item.download_speed]));
    for (const name of new Set([...byInternet.keys(), ...now.keys()])) {
      let line = [...(byInternet.get(name) ?? new Array(HISTORY_SECONDS).fill(0)), now.get(name) ?? 0];
      if (line.length > HISTORY_SECONDS) line = line.slice(-HISTORY_SECONDS);
      // An internet that carried nothing for a minute leaves the chart.
      if (line.every((value) => value <= 0)) byInternet.delete(name);
      else byInternet.set(name, line);
    }
    internetHistory.set(key, byInternet);
  }
  for (const key of history.keys()) {
    if (!seen.has(key)) history.delete(key);
  }
  for (const key of internetHistory.keys()) {
    if (!seen.has(key)) internetHistory.delete(key);
  }
  apps.value = list;
  historyTick.value++;
}

async function watch(on: boolean) {
  try {
    const snapshot = await SetAppTrafficWatch(watcherId, on);
    if (on) {
      running.value = snapshot != null;
      if (snapshot) {
        gaming.value = snapshot.gaming;
        remember(snapshot.apps ?? [], true);
      }
    }
  } catch {
    running.value = false;
  }
}

function onVisibility() {
  watch(!document.hidden);
}

function start() {
  document.addEventListener("visibilitychange", onVisibility);
  offPage = [
    Events.On("app-traffic", ({ data }: any) => {
      const payload = Array.isArray(data) ? data[0] : data;
      if (!payload) return;
      running.value = true;
      gaming.value = payload.gaming;
      remember(payload.apps ?? [], false);
    }),
    Events.On("service-started", () => !document.hidden && watch(true)),
    Events.On("service-stopped", () => {
      running.value = false;
      apps.value = [];
      history.clear();
      internetHistory.clear();
    }),
  ];
  watch(true);
}

function stop() {
  document.removeEventListener("visibilitychange", onVisibility);
  offPage.forEach((off) => off());
  offPage = [];
  watch(false);
}

/** An exe's display name and icon, read once per path. */
function infoOf(path: string) {
  const key = keyOf(path);
  if (!appInfo.has(key)) {
    appInfo.set(key, { name: "", icon: "" });
    GetAppInfo(path)
      .then((info) => appInfo.set(key, { name: info.name, icon: info.icon }))
      .catch(() => {});
  }
  return appInfo.get(key)!;
}

export async function saveLimit(limit: AppLimit) {
  await saveAppLimit(limit);
  const index = limits.value.findIndex((item) => item.id === limit.id);
  if (index >= 0) limits.value.splice(index, 1, { ...limit });
  else limits.value.push({ ...limit });
  pushLimits();
}

export async function deleteLimit(id: string) {
  await removeAppLimit(id);
  limits.value = limits.value.filter((item) => item.id !== id);
  pushLimits();
}

/** A cap applies right now: on, time not up, gaming if "only while gaming",
 * and not a profile set to never be capped. */
export function limitActiveNow(limit: AppLimit) {
  return (
    limit.enabled &&
    !expired(limit) &&
    (!limit.only_while_gaming || gaming.value) &&
    !(limit.kind === "profile" && limit.download <= 0)
  );
}

/** How many caps apply right now. */
export const activeLimitCount = computed(() => limits.value.filter(limitActiveNow).length);

/** The cap each high-traffic profile LagZap routes gets. */
export const highTrafficLimit = computed(() => limits.value.find((limit) => limit.kind === "high_traffic") ?? null);

/** One internet's (adapter's) speed cap. */
export function adapterLimit(name: string) {
  const key = name.toLowerCase();
  return limits.value.find((limit) => limit.kind === "adapter" && limit.path.toLowerCase() === key) ?? null;
}

/** A routed profile's own cap (download 0: never capped). */
export function profileLimit(profileId: string) {
  return limits.value.find((limit) => limit.kind === "profile" && limit.path === profileId) ?? null;
}

/** The Bandwidth Control page: streams while mounted. */
export function useBandwidthControl() {
  onMounted(() => {
    if (watchers++ === 0) start();
  });
  onBeforeUnmount(() => {
    if (--watchers === 0) stop();
  });
  return {
    apps,
    gaming,
    running,
    limits,
    routes,
    historyTick,
    historyOf: (path: string) => history.get(keyOf(path)) ?? [],
    /** The app's last minute per internet, by name (empty: none known). */
    internetsOf: (path: string) =>
      [...(internetHistory.get(keyOf(path)) ?? new Map<string, number[]>())].map(([name, points]) => ({ name, points })),
    infoOf,
    saveLimit,
    deleteLimit,
    saveRoute,
    deleteRoute,
    tunnels,
    saveTunnel,
    deleteTunnel,
  };
}
