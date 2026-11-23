import type { ProfileState, TitleState } from "~/bindings/github.com/lagzap/zap/data";
import { RoutingMode } from "~/bindings/github.com/lagzap/zap/data";

/** A title's route choices and its profiles' own (as in the core's
 * title_route.go). A profile follows its title for each group it leaves
 * unset; changing a group on the title clears it on the title's profiles. */
export const ROUTE_GROUPS = {
  /** Set when mode is. */
  location: ["mode", "regions", "countries", "cities", "node_id"],
  /** Set when default_interface is. */
  internet: ["default_interface", "network_interfaces"],
  /** Set when any is. */
  routes: ["tcp_connections", "udp_connections", "route_connections"],
  domestic: ["allow_local_routes"],
  fallback: ["relay_transport_fallback"],
  transport: ["preferred_transport"],
} as const;
export type RouteGroup = keyof typeof ROUTE_GROUPS;
type RouteState = Partial<ProfileState> | Partial<TitleState>;

const GROUP_OF: Record<string, RouteGroup> = Object.fromEntries(
  (Object.entries(ROUTE_GROUPS) as [RouteGroup, readonly string[]][]).flatMap(([g, keys]) => keys.map((k) => [k, g])),
);
const ROUTE_KEYS = Object.keys(GROUP_OF);
const LIST_KEYS = new Set(["regions", "countries", "cities", "network_interfaces"]);

const given = (v: unknown) => v !== null && v !== undefined;

/** The state has its own choice for the group. */
export function hasGroup(st: RouteState | null | undefined, g: RouteGroup): boolean {
  if (!st) return false;
  const s = st as Record<string, unknown>;
  switch (g) {
    case "location":
      return given(s.mode);
    case "internet":
      return given(s.default_interface);
    case "routes":
      return given(s.tcp_connections) || given(s.udp_connections) || given(s.route_connections);
    default:
      return given(s[ROUTE_GROUPS[g][0]]);
  }
}

/** Unset values: what a state has for a group it does not set. */
function emptyGroup(g: RouteGroup): Record<string, unknown> {
  switch (g) {
    case "location":
      return { mode: null, regions: [], countries: [], cities: [], node_id: null };
    case "internet":
      return { default_interface: null, network_interfaces: [] };
    default:
      return Object.fromEntries(ROUTE_GROUPS[g].map((k) => [k, null]));
  }
}

/** The state follows (its title, or the defaults) for the group again. */
export function clearGroup(st: RouteState, g: RouteGroup) {
  Object.assign(st, emptyGroup(g));
}

/** The group's values of one state, copied. */
function groupValues(st: RouteState | undefined, g: RouteGroup): Record<string, unknown> {
  const s = (st ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    ROUTE_GROUPS[g].map((k) => {
      const v = s[k];
      return [k, Array.isArray(v) ? [...v] : (v ?? (LIST_KEYS.has(k) ? [] : null))];
    }),
  );
}

/**
 * What a profile reads: its own state, each group it leaves unset taken
 * from its title (Automatic when neither sets a location). Writing a field
 * makes the field's group the profile's own, starting from what it read.
 * The view is over `own` (reactive), so reads and writes track as usual;
 * save `own` itself.
 */
export function profileView(own: ProfileState, title: () => TitleState | undefined): ProfileState {
  const source = (t: ProfileState, g: RouteGroup): RouteState | undefined =>
    hasGroup(t, g) ? t : hasGroup(title(), g) ? title() : undefined;
  /** The field's group becomes the profile's own, from what it showed.
   * Route counts are always written whole (a Smart total, or TCP and UDP),
   * so they start empty. */
  const adopt = (t: ProfileState, k: string | symbol) => {
    const g = typeof k === "string" ? GROUP_OF[k] : undefined;
    if (!g || g === "routes" || hasGroup(t, g)) return;
    const from = groupValues(source(t, g), g);
    if (g === "location" && !given(from.mode)) from.mode = RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL;
    if (g === "internet" && !given(from.default_interface)) from.default_interface = "";
    Object.assign(t, from);
  };
  return new Proxy(own, {
    // Reads and writes go to `own` itself (not through the view), so its
    // reactivity sees them.
    get(t, k) {
      const g = typeof k === "string" ? GROUP_OF[k] : undefined;
      if (!g || hasGroup(t, g)) return Reflect.get(t, k);
      const v = (source(t, g) as Record<string, unknown> | undefined)?.[k as string];
      if (k === "mode") return v ?? RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL;
      return v ?? Reflect.get(t, k);
    },
    set(t, k, v) {
      adopt(t, k);
      return Reflect.set(t, k, v);
    },
    deleteProperty(t, k) {
      adopt(t, k);
      return Reflect.deleteProperty(t, k);
    },
    has(t, k) {
      return (typeof k === "string" && k in GROUP_OF) || Reflect.has(t, k);
    },
    ownKeys(t) {
      return [...new Set([...Reflect.ownKeys(t), ...ROUTE_KEYS])];
    },
    getOwnPropertyDescriptor(t, k) {
      const d = Reflect.getOwnPropertyDescriptor(t, k);
      if (d || typeof k !== "string" || !(k in GROUP_OF)) return d;
      return { configurable: true, enumerable: true, writable: true, value: undefined };
    },
  });
}
