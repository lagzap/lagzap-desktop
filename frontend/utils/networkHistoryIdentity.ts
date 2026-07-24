/**
 * Resolve hop path keys (often IPs) to node id / city / country for local history.
 * Never persist raw IPs in IndexedDB history.
 */

export type HistoryPathRef = {
  /** Cyrex node ids for resolved hops (empty if unknown). */
  node_ids: string[];
  /** Human label e.g. "Frankfurt" or "Tehran → Frankfurt" — never an IP. */
  label: string;
  /** ISO country codes when known. */
  countries: string[];
};

type HistoryNodeLike = {
  id: string;
  name?: string;
  ipv4?: string;
  ipv6?: string;
  country?: string;
  city?: unknown;
};

const IPV4_RE =
  /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-f:]+$/i;

export function looksLikeIp(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (IPV4_RE.test(v)) return true;
  if (v.includes(":") && IPV6_RE.test(v)) return true;
  return false;
}

function buildIpIndex(
  nodes: Record<string, HistoryNodeLike> | null | undefined
): Map<string, HistoryNodeLike> {
  const map = new Map<string, HistoryNodeLike>();
  if (!nodes) {
    return map;
  }
  for (const node of Object.values(nodes)) {
    if (!node) continue;
    if (node.ipv4) map.set(node.ipv4, node);
    if (node.ipv6) map.set(node.ipv6, node);
    map.set(node.id, node);
  }
  return map;
}

function nodeLabel(
  node: HistoryNodeLike,
  localizeCity?: (city: unknown) => string
): string {
  if (localizeCity && node.city) {
    const city = localizeCity(node.city);
    if (typeof city === "string" && city.trim()) {
      return city.trim();
    }
  }
  if (node.name && !looksLikeIp(node.name)) {
    return node.name;
  }
  if (node.country) {
    return node.country.toUpperCase();
  }
  return "Server";
}

/**
 * Convert `ip` or `ip->ip` path keys into node refs. Unresolvable IPs are dropped
 * (never stored), replaced with a generic hop label only if the whole path is empty.
 */
export function pathKeyToHistoryRef(
  pathKey: string | undefined | null,
  nodes: Record<string, HistoryNodeLike> | null | undefined,
  localizeCity?: (city: unknown) => string
): HistoryPathRef | undefined {
  if (!pathKey || !pathKey.trim()) {
    return undefined;
  }

  const hops = pathKey.split("->").map((h) => h.trim()).filter(Boolean);
  if (hops.length === 0) {
    return undefined;
  }

  const byIp = buildIpIndex(nodes);
  const node_ids: string[] = [];
  const countries: string[] = [];
  const labels: string[] = [];

  for (const hop of hops) {
    const node = byIp.get(hop);
    if (node) {
      node_ids.push(node.id);
      if (node.country) {
        countries.push(node.country.toUpperCase());
      }
      labels.push(nodeLabel(node, localizeCity));
      continue;
    }
    // Already a node id?
    if (nodes?.[hop]) {
      const n = nodes[hop];
      node_ids.push(n.id);
      if (n.country) countries.push(n.country.toUpperCase());
      labels.push(nodeLabel(n, localizeCity));
      continue;
    }
    // Raw IP or unknown — do not store the IP.
    if (looksLikeIp(hop)) {
      labels.push("Unknown server");
      continue;
    }
    // Non-IP opaque token (safe-ish) — keep as label only, not as IP.
    if (!looksLikeIp(hop)) {
      labels.push(hop);
    }
  }

  if (labels.length === 0) {
    return undefined;
  }

  return {
    node_ids: [...new Set(node_ids)],
    countries: [...new Set(countries)],
    label: labels.join(" → "),
  };
}

/** Resolve a single entry host/IP for relay-path events. */
export function entryToHistoryRef(
  entry: string | undefined | null,
  nodes: Record<string, HistoryNodeLike> | null | undefined,
  localizeCity?: (city: unknown) => string
): { node_id?: string; label?: string; country?: string } | undefined {
  if (!entry || !entry.trim()) {
    return undefined;
  }
  const ref = pathKeyToHistoryRef(entry.trim(), nodes, localizeCity);
  if (!ref) {
    return undefined;
  }
  return {
    node_id: ref.node_ids[0],
    label: ref.label,
    country: ref.countries[0],
  };
}
