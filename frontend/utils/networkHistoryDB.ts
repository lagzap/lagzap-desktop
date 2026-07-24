/**
 * Local network-situation history (IndexedDB).
 * Detail stays on-device for reports; server sync uses aggregates only.
 */

import {
  entryToHistoryRef,
  pathKeyToHistoryRef,
  type HistoryPathRef,
} from "~/utils/networkHistoryIdentity";

const DB_NAME = "lagzap-network-history";
const DB_VERSION = 3;
const EVENTS_STORE = "events";
const SAMPLES_STORE = "samples";
const USAGE_STORE = "usage";
const EDGE_STORE = "edge";

export const NETWORK_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 50_000;
const MAX_SAMPLES = 100_000;
const MAX_USAGE = 80_000;
const MAX_EDGE = 120_000;
const PRUNE_EVERY_WRITES = 40;

export type NetworkHistoryEventKind = "lag_fix" | "relay_path";

export type NetworkHistoryLagFixPayload = {
  route_tag?: string;
  status?: string;
  reason?: string;
  user_side_lag?: boolean;
  /** Resolved path identity — never raw IPs. */
  old_path?: HistoryPathRef;
  new_path?: HistoryPathRef;
  improvement_ms?: number;
  internet_ms?: number;
  before_latency?: number;
  after_latency?: number;
  before_loss?: number;
  after_loss?: number;
};

export type NetworkHistoryRelayPathPayload = {
  kind?: string;
  route_tag?: string;
  iface?: string;
  is_tcp?: boolean;
  /** Resolved entry — never raw IP. */
  entry_node_id?: string;
  entry_label?: string;
  entry_country?: string;
};

export type NetworkHistoryEvent = {
  id: string;
  kind: NetworkHistoryEventKind;
  /** Unix ms */
  at: number;
  lag_fix?: NetworkHistoryLagFixPayload;
  relay_path?: NetworkHistoryRelayPathPayload;
};

export type NetworkHistorySample = {
  id: string;
  /** Unix ms */
  at: number;
  latency_ms: number;
  loss_pct: number;
  protected: boolean;
  iface_count: number;
  route_count: number;
  /** True when this sample was written because of a sharp latency jump. */
  spike?: boolean;
};

export type NetworkHistoryUsageKind = "country" | "server" | "city" | "region";

/** Sparse location/server sightings while routing (for “where you connected”). */
export type NetworkHistoryUsage = {
  id: string;
  at: number;
  kind: NetworkHistoryUsageKind;
  key: string;
  label: string;
};

/**
 * User→edge latency snapshot for one city (best of nodes in that city).
 * Never stores node ids, node names, or IPs.
 */
export type NetworkHistoryEdge = {
  id: string;
  at: number;
  city_key: string;
  city: string;
  country: string;
  region: string;
  region_label: string;
  latency_ms: number;
};

function waitForRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;
let writesSincePrune = 0;

function ensureStore(
  db: IDBDatabase,
  name: string,
  withKindIndex = false
): void {
  if (db.objectStoreNames.contains(name)) {
    return;
  }
  const store = db.createObjectStore(name, { keyPath: "id" });
  store.createIndex("at", "at", { unique: false });
  if (withKindIndex) {
    store.createIndex("kind", "kind", { unique: false });
  }
}

export function openNetworkHistoryDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        ensureStore(db, EVENTS_STORE, true);
        ensureStore(db, SAMPLES_STORE);
        ensureStore(db, USAGE_STORE, true);
        ensureStore(db, EDGE_STORE);
      };
    });
  }
  return dbPromise;
}

function isoOrMsToAt(value?: string | number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

export function newHistoryId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function iterateCursor(
  request: IDBRequest<IDBCursorWithValue | null>,
  visit: (cursor: IDBCursorWithValue) => boolean | void
): Promise<void> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const cont = visit(cursor);
      if (cont === false) {
        resolve();
        return;
      }
      cursor.continue();
    };
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB cursor failed"));
  });
}

async function pruneStore(
  store: IDBObjectStore,
  cutoff: number,
  maxRows: number
): Promise<void> {
  const index = store.index("at");
  await iterateCursor(
    index.openCursor(IDBKeyRange.upperBound(cutoff, true)),
    (cursor) => {
      cursor.delete();
    }
  );

  const count = await waitForRequest<number>(store.count());
  if (count <= maxRows) {
    return;
  }
  const overflow = count - maxRows;
  let removed = 0;
  await iterateCursor(index.openCursor(), (cursor) => {
    cursor.delete();
    removed += 1;
    if (removed >= overflow) {
      return false;
    }
  });
}

async function maybePrune(db: IDBDatabase): Promise<void> {
  writesSincePrune += 1;
  if (writesSincePrune < PRUNE_EVERY_WRITES) {
    return;
  }
  writesSincePrune = 0;
  const cutoff = Date.now() - NETWORK_HISTORY_RETENTION_MS;
  const storeNames = [
    EVENTS_STORE,
    SAMPLES_STORE,
    USAGE_STORE,
    EDGE_STORE,
  ].filter((name) => db.objectStoreNames.contains(name));
  const tx = db.transaction(storeNames, "readwrite");
  if (storeNames.includes(EVENTS_STORE)) {
    await pruneStore(tx.objectStore(EVENTS_STORE), cutoff, MAX_EVENTS);
  }
  if (storeNames.includes(SAMPLES_STORE)) {
    await pruneStore(tx.objectStore(SAMPLES_STORE), cutoff, MAX_SAMPLES);
  }
  if (storeNames.includes(USAGE_STORE)) {
    await pruneStore(tx.objectStore(USAGE_STORE), cutoff, MAX_USAGE);
  }
  if (storeNames.includes(EDGE_STORE)) {
    await pruneStore(tx.objectStore(EDGE_STORE), cutoff, MAX_EDGE);
  }
  await waitForTransaction(tx);
}

export async function putNetworkHistoryEvent(
  event: NetworkHistoryEvent
): Promise<void> {
  const db = await openNetworkHistoryDB();
  const tx = db.transaction([EVENTS_STORE], "readwrite");
  await waitForRequest(tx.objectStore(EVENTS_STORE).put(event));
  await waitForTransaction(tx);
  void maybePrune(db).catch(() => undefined);
}

export async function putNetworkHistoryEvents(
  events: NetworkHistoryEvent[]
): Promise<void> {
  if (events.length === 0) {
    return;
  }
  const db = await openNetworkHistoryDB();
  const tx = db.transaction([EVENTS_STORE], "readwrite");
  const store = tx.objectStore(EVENTS_STORE);
  for (const event of events) {
    store.put(event);
  }
  await waitForTransaction(tx);
  void maybePrune(db).catch(() => undefined);
}

export async function putNetworkHistorySample(
  sample: NetworkHistorySample
): Promise<void> {
  const db = await openNetworkHistoryDB();
  const tx = db.transaction([SAMPLES_STORE], "readwrite");
  await waitForRequest(tx.objectStore(SAMPLES_STORE).put(sample));
  await waitForTransaction(tx);
  void maybePrune(db).catch(() => undefined);
}

export async function putNetworkHistoryUsageBatch(
  rows: NetworkHistoryUsage[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const db = await openNetworkHistoryDB();
  if (!db.objectStoreNames.contains(USAGE_STORE)) {
    return;
  }
  const tx = db.transaction([USAGE_STORE], "readwrite");
  const store = tx.objectStore(USAGE_STORE);
  for (const row of rows) {
    store.put(row);
  }
  await waitForTransaction(tx);
  void maybePrune(db).catch(() => undefined);
}

export async function putNetworkHistoryEdgeBatch(
  rows: NetworkHistoryEdge[]
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const db = await openNetworkHistoryDB();
  if (!db.objectStoreNames.contains(EDGE_STORE)) {
    return;
  }
  const tx = db.transaction([EDGE_STORE], "readwrite");
  const store = tx.objectStore(EDGE_STORE);
  for (const row of rows) {
    store.put(row);
  }
  await waitForTransaction(tx);
  void maybePrune(db).catch(() => undefined);
}

async function getByAtRange<T extends { at: number }>(
  storeName: string,
  fromMs: number,
  toMs: number
): Promise<T[]> {
  const db = await openNetworkHistoryDB();
  if (!db.objectStoreNames.contains(storeName)) {
    return [];
  }
  const tx = db.transaction([storeName], "readonly");
  const index = tx.objectStore(storeName).index("at");
  const range = IDBKeyRange.bound(fromMs, toMs, false, false);
  const rows = await waitForRequest<T[]>(index.getAll(range));
  await waitForTransaction(tx);
  return rows;
}

export async function getNetworkHistoryEvents(
  fromMs: number,
  toMs: number
): Promise<NetworkHistoryEvent[]> {
  return getByAtRange<NetworkHistoryEvent>(EVENTS_STORE, fromMs, toMs);
}

export async function getNetworkHistorySamples(
  fromMs: number,
  toMs: number
): Promise<NetworkHistorySample[]> {
  return getByAtRange<NetworkHistorySample>(SAMPLES_STORE, fromMs, toMs);
}

export async function getNetworkHistoryUsage(
  fromMs: number,
  toMs: number
): Promise<NetworkHistoryUsage[]> {
  return getByAtRange<NetworkHistoryUsage>(USAGE_STORE, fromMs, toMs);
}

export async function getNetworkHistoryEdge(
  fromMs: number,
  toMs: number
): Promise<NetworkHistoryEdge[]> {
  return getByAtRange<NetworkHistoryEdge>(EDGE_STORE, fromMs, toMs);
}

export async function clearNetworkHistory(): Promise<void> {
  const db = await openNetworkHistoryDB();
  const names = [EVENTS_STORE, SAMPLES_STORE, USAGE_STORE, EDGE_STORE].filter(
    (name) => db.objectStoreNames.contains(name)
  );
  const tx = db.transaction(names, "readwrite");
  for (const name of names) {
    tx.objectStore(name).clear();
  }
  await waitForTransaction(tx);
  writesSincePrune = 0;
}

export async function getNetworkHistoryCounts(): Promise<{
  events: number;
  samples: number;
  usage: number;
  edge: number;
}> {
  const db = await openNetworkHistoryDB();
  const names = [EVENTS_STORE, SAMPLES_STORE, USAGE_STORE, EDGE_STORE].filter(
    (name) => db.objectStoreNames.contains(name)
  );
  const tx = db.transaction(names, "readonly");
  const events = await waitForRequest<number>(
    tx.objectStore(EVENTS_STORE).count()
  );
  const samples = await waitForRequest<number>(
    tx.objectStore(SAMPLES_STORE).count()
  );
  const usage = names.includes(USAGE_STORE)
    ? await waitForRequest<number>(tx.objectStore(USAGE_STORE).count())
    : 0;
  const edge = names.includes(EDGE_STORE)
    ? await waitForRequest<number>(tx.objectStore(EDGE_STORE).count())
    : 0;
  await waitForTransaction(tx);
  return { events, samples, usage, edge };
}

export function lagFixToHistoryEvent(
  fix: {
    id: string;
    timestamp?: string;
    route_tag?: string;
    status?: string;
    reason?: string;
    user_side_lag?: boolean;
    old_path_key?: string;
    new_path_key?: string;
    improvement_ms?: number;
    before?: { avg_latency?: number; packet_loss?: number };
    after?: { avg_latency?: number; packet_loss?: number };
    global_before?: { avg_latency?: number };
  },
  nodes?: Record<string, any> | null,
  localizeCity?: (city: unknown) => string
): NetworkHistoryEvent {
  return {
    id: `lag_${fix.id}`,
    kind: "lag_fix",
    at: isoOrMsToAt(fix.timestamp),
    lag_fix: {
      route_tag: fix.route_tag,
      status: fix.status,
      reason: fix.reason,
      user_side_lag: !!fix.user_side_lag,
      old_path: pathKeyToHistoryRef(fix.old_path_key, nodes, localizeCity),
      new_path: pathKeyToHistoryRef(fix.new_path_key, nodes, localizeCity),
      improvement_ms: fix.improvement_ms,
      internet_ms: fix.global_before?.avg_latency,
      before_latency: fix.before?.avg_latency,
      after_latency: fix.after?.avg_latency,
      before_loss: fix.before?.packet_loss,
      after_loss: fix.after?.packet_loss,
    },
  };
}

export function relayPathToHistoryEvent(
  event: {
    id: string;
    timestamp?: string;
    kind?: string;
    route_tag?: string;
    iface?: string;
    is_tcp?: boolean;
    entry?: string;
  },
  nodes?: Record<string, any> | null,
  localizeCity?: (city: unknown) => string
): NetworkHistoryEvent {
  const entry = entryToHistoryRef(event.entry, nodes, localizeCity);
  return {
    id: `path_${event.id}`,
    kind: "relay_path",
    at: isoOrMsToAt(event.timestamp),
    relay_path: {
      kind: event.kind,
      route_tag: event.route_tag,
      iface: event.iface,
      is_tcp: event.is_tcp,
      entry_node_id: entry?.node_id,
      entry_label: entry?.label,
      entry_country: entry?.country,
    },
  };
}
