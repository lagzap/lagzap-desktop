/** Session quality every 5 minutes (games) or 10 (other profiles), from Go's
 * "stats-interval" events; kept SESSION_INTERVALS_KEEP_MS on this PC. */
const SESSION_INTERVALS = "sessionIntervals";
const SESSION_INTERVALS_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
/** Bandwidth Control speed caps. Kept only on this PC: Go is sent them
 * whenever its service starts. */
const APP_LIMITS = "appLimits";
/** Apps sent through another internet; kept like the speed caps. */
const APP_ROUTES = "appRoutes";
/** Apps (or the whole PC) sent through a Dedicated IP; kept like the caps. */
const APP_TUNNELS = "appTunnels";

export const openDatabase = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("lagzapDatabase", 8);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains("tokens")) {
        db.createObjectStore("tokens", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(SESSION_INTERVALS)) {
        const store = db.createObjectStore(SESSION_INTERVALS, { keyPath: "id" });
        store.createIndex("profile_id", "profile_id");
        store.createIndex("session_id", "session_id");
        store.createIndex("ended_at", "ended_at");
      }
      if (!db.objectStoreNames.contains(APP_LIMITS)) {
        db.createObjectStore(APP_LIMITS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(APP_ROUTES)) {
        db.createObjectStore(APP_ROUTES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(APP_TUNNELS)) {
        db.createObjectStore(APP_TUNNELS, { keyPath: "id" });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
};

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveToken(key: string, token: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(["tokens"], "readwrite");
  const store = transaction.objectStore("tokens");
  store.put({ key, token });
  await waitForTransaction(transaction);
}

export async function getToken(key: string): Promise<string | undefined> {
  const db = await openDatabase();
  const transaction = db.transaction(["tokens"], "readonly");
  const store = transaction.objectStore("tokens");
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => {
      resolve(request.result?.token);
    };
    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function removeToken(key: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(["tokens"], "readwrite");
  const store = transaction.objectStore("tokens");
  store.delete(key);
  await waitForTransaction(transaction);
}

export interface SessionInterval {
  id: string;
  session_id: string;
  profile_id: string;
  title_id?: string;
  game?: boolean;
  started_at: number;
  ended_at: number;
  latency?: {
    samples?: number;
    lost?: number;
    avg_ms?: number;
    min_ms?: number;
    p50_ms?: number;
    p95_ms?: number;
    max_ms?: number;
    jitter_ms?: number;
  };
  route_changes?: number;
  interruptions?: number;
  disconnects?: number;
  lag_fixes?: number;
  lag_fixes_ok?: number;
  lag_fixes_failed?: number;
}

/** Stores one interval and drops those older than the keep window. */
export async function saveSessionInterval(interval: Omit<SessionInterval, "id">): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([SESSION_INTERVALS], "readwrite");
  const store = transaction.objectStore(SESSION_INTERVALS);
  store.put({ ...interval, id: `${interval.session_id}:${interval.started_at}` });
  const cutoff = IDBKeyRange.upperBound(Date.now() - SESSION_INTERVALS_KEEP_MS);
  const old = store.index("ended_at").openCursor(cutoff);
  old.onsuccess = () => {
    const cursor = old.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
    }
  };
  await waitForTransaction(transaction);
}

/** A profile's intervals since a time (ms), oldest first. */
export async function listSessionIntervals(profileId: string, since = 0): Promise<SessionInterval[]> {
  const db = await openDatabase();
  const transaction = db.transaction([SESSION_INTERVALS], "readonly");
  const index = transaction.objectStore(SESSION_INTERVALS).index("profile_id");
  return new Promise((resolve, reject) => {
    const request = index.getAll(profileId);
    request.onsuccess = () => {
      const rows = (request.result as SessionInterval[]).filter((r) => r.ended_at >= since);
      rows.sort((a, b) => a.started_at - b.started_at);
      resolve(rows);
    };
    request.onerror = () => reject(request.error);
  });
}

/** One Bandwidth Control speed cap (the shape Go's SetAppLimits takes). */
export interface AppLimit {
  id: string;
  /** "exe", "folder", "pc" (every app on this PC; path is ""),
   * "high_traffic" (each high-traffic profile LagZap routes; path is "") or
   * "profile" (one routed profile; path is its id, download 0 = never). */
  kind: string;
  path: string;
  /** Bytes per second. */
  download: number;
  only_while_gaming: boolean;
  enabled: boolean;
  /** The cap ends then (Unix ms); unset keeps it. */
  expires_at?: number;
  /** The cap ends when LagZap closes. */
  until_restart?: boolean;
}

export async function listAppLimits(): Promise<AppLimit[]> {
  const db = await openDatabase();
  const transaction = db.transaction([APP_LIMITS], "readonly");
  const store = transaction.objectStore(APP_LIMITS);
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as AppLimit[]);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAppLimit(limit: AppLimit): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([APP_LIMITS], "readwrite");
  transaction.objectStore(APP_LIMITS).put({ ...limit });
  await waitForTransaction(transaction);
}

export async function removeAppLimit(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([APP_LIMITS], "readwrite");
  transaction.objectStore(APP_LIMITS).delete(id);
  await waitForTransaction(transaction);
}

/** One app (exe) or folder sent through another internet (the shape Go's
 * SetAppRoutes takes). */
export interface AppRoute {
  id: string;
  /** "exe" or "folder". */
  kind: string;
  path: string;
  /** The internet (adapter name) its traffic goes through. */
  interface: string;
  enabled: boolean;
}

export async function listAppRoutes(): Promise<AppRoute[]> {
  const db = await openDatabase();
  const transaction = db.transaction([APP_ROUTES], "readonly");
  const store = transaction.objectStore(APP_ROUTES);
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as AppRoute[]);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAppRoute(route: AppRoute): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([APP_ROUTES], "readwrite");
  transaction.objectStore(APP_ROUTES).put({ ...route });
  await waitForTransaction(transaction);
}

export async function removeAppRoute(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([APP_ROUTES], "readwrite");
  transaction.objectStore(APP_ROUTES).delete(id);
  await waitForTransaction(transaction);
}

/** One app (exe), folder or the whole PC ("pc", no path) sent through a
 * saved Dedicated IP (WireGuard) config (the shape Go's SetAppTunnels
 * takes). */
export interface AppTunnel {
  id: string;
  /** "exe", "folder" or "pc". */
  kind: string;
  path: string;
  config_id: string;
  enabled: boolean;
}

export async function listAppTunnels(): Promise<AppTunnel[]> {
  const db = await openDatabase();
  const transaction = db.transaction([APP_TUNNELS], "readonly");
  const store = transaction.objectStore(APP_TUNNELS);
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result as AppTunnel[]);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAppTunnel(tunnel: AppTunnel): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([APP_TUNNELS], "readwrite");
  transaction.objectStore(APP_TUNNELS).put({ ...tunnel });
  await waitForTransaction(transaction);
}

export async function removeAppTunnel(id: string): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([APP_TUNNELS], "readwrite");
  transaction.objectStore(APP_TUNNELS).delete(id);
  await waitForTransaction(transaction);
}
