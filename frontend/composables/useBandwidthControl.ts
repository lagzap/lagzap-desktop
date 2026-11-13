import { Events } from "@wailsio/runtime";
import {
  Gaming,
  GetAppInfo,
  SetAppLimits,
  SetAppTrafficWatch,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { AppLimitRule, type AppTraffic } from "~/bindings/github.com/lagzap/lagzap/adapter";
import { listAppLimits, removeAppLimit, saveAppLimit, type AppLimit } from "~/utils/indexedDB";

/** Seconds of download speed each app's sparkline shows. */
export const HISTORY_SECONDS = 60;

// Go counts and caps every app on the NDIS layer. This module keeps the caps
// (IndexedDB, this PC only), sends them to Go, and while the page is open
// holds the latest per-app snapshot and each app's last minute of speed.
const limits = ref<AppLimit[]>([]);
const apps = shallowRef<AppTraffic[]>([]);
const history = new Map<string, number[]>();
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
  setInterval(dropExpired, 30_000);
  Events.On("service-started", pushLimits);
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
  }
  for (const key of history.keys()) {
    if (!seen.has(key)) history.delete(key);
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
    historyTick,
    historyOf: (path: string) => history.get(keyOf(path)) ?? [],
    infoOf,
    saveLimit,
    deleteLimit,
  };
}
