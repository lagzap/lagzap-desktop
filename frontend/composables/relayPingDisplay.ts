import type { NodeRoute, RelayRoute } from "~/bindings/github.com/lagzap/zap/data";
import {
  bestRouteRelayLatency,
  isPlausibleProbeForRoute,
  nodeRoutePathKey,
  routeHopFloorMs,
  routeRelayLatency,
} from "~/composables/useProfileDisplayRoutes";
import type { RouteProbeEvent } from "~/types/monitoring";
import { toRaw } from "vue";

/** Prefer hop-floor-safe RTT from routeRelayLatency. */
export function routeDisplayLatency(route: NodeRoute | null | undefined): number {
  return routeRelayLatency(route);
}

export function bestRouteDisplayLatency(
  routes: NodeRoute[] | null | undefined
): { ping: number; score: number; loss: number; route: NodeRoute | null } {
  if (!routes?.length) {
    return { ping: 0, score: 0, loss: 0, route: null };
  }
  return bestRouteRelayLatency(routes);
}

export function bestLiveProbeMsForRelay(
  tag: string | null | undefined,
  relayRoute: RelayRoute | null | undefined,
  routeProbeHistory: Record<string, RouteProbeEvent[]>
): number | null {
  if (!tag) {
    return null;
  }
  const events =
    routeProbeHistory[tag] ??
    routeProbeHistory[`${tag}-ipv4-udp`] ??
    routeProbeHistory[`${tag}-ipv4-tcp`];
  if (!events?.length) {
    return null;
  }
  const slots = events[events.length - 1]?.slots ?? [];
  if (!slots.length) {
    return null;
  }

  const routes = relayRoute?.routes ?? [];
  let best: number | null = null;
  if (routes.length > 0) {
    for (const route of routes) {
      const pathKey = nodeRoutePathKey(route);
      const floor = routeHopFloorMs(route);
      for (const slot of slots) {
        if (!(slot.latency > 0)) {
          continue;
        }
        if (slot.path_key && pathKey && slot.path_key !== pathKey) {
          continue;
        }
        if (!isPlausibleProbeForRoute(slot.latency, route, floor)) {
          continue;
        }
        // Lowest plausible probe: the last one was whichever leg (other NIC,
        // standby) happened to be listed last, so the number jumped around.
        best = best == null ? slot.latency : Math.min(best, slot.latency);
      }
    }
  }
  if (best == null) {
    for (const slot of slots) {
      if (!(slot.latency > 0) || slot.latency >= 500) {
        continue;
      }
      // No topology floor — still reject absurdly low LAN-like probes for relays.
      if (slot.latency < 20) {
        continue;
      }
      best = best == null ? slot.latency : Math.min(best, slot.latency);
    }
  }
  return best != null ? Math.round(best) : null;
}

/**
 * Single source of truth for list / selector / estimated-style pings:
 * live probe when available, else best measured path latency.
 */
export function displayPingMsForRelay(
  tag: string | null | undefined,
  relayRoute: RelayRoute | null | undefined,
  routeProbeHistory: Record<string, RouteProbeEvent[]>
): number | null {
  const live = bestLiveProbeMsForRelay(tag, relayRoute, routeProbeHistory);
  if (live != null && live > 0) {
    return live;
  }
  const best = bestRouteDisplayLatency(relayRoute?.routes);
  return best.ping > 0 ? Math.round(best.ping) : null;
}

export function displayScoreForRelay(
  relayRoute: RelayRoute | null | undefined
): number | null {
  const best = bestRouteDisplayLatency(relayRoute?.routes);
  return best.score > 0 ? best.score : null;
}

/** The lowest ping a relay showed recently: the best plausible probe of
 * each probe round still kept, so the number holds still between rounds.
 * Without probes, the same fallback as displayPingMsForRelay. */
export function recentMinPingMsForRelay(
  tag: string | null | undefined,
  relayRoute: RelayRoute | null | undefined,
  routeProbeHistory: Record<string, RouteProbeEvent[]>
): number | null {
  if (!tag) {
    return null;
  }
  const key = [tag, `${tag}-ipv4-udp`, `${tag}-ipv4-tcp`].find((k) => routeProbeHistory[k]?.length);
  // Plain objects: every read through Vue's proxies was tracked, and this
  // runs for every place on every probe update.
  const route = relayRoute ? toRaw(relayRoute) : relayRoute;
  let min: number | null = null;
  for (const proxied of key ? routeProbeHistory[key]! : []) {
    const event = toRaw(proxied);
    // A probe round never changes once it arrived: its best ping is worked
    // out once (per relay route it was judged against), not on every update.
    let byRoute = probeRoundBest.get(event);
    if (!byRoute) {
      byRoute = new WeakMap();
      probeRoundBest.set(event, byRoute);
    }
    const routeKey = (route ?? NO_ROUTE) as object;
    let ms = byRoute.get(routeKey);
    if (ms === undefined) {
      ms = bestLiveProbeMsForRelay(key, route, { [key!]: [event] });
      byRoute.set(routeKey, ms);
    }
    if (ms != null && ms > 0) {
      min = min == null ? ms : Math.min(min, ms);
    }
  }
  return min ?? displayPingMsForRelay(tag, relayRoute, routeProbeHistory);
}

/** Each probe round's best ping, by the relay route it was judged with. */
const probeRoundBest = new WeakMap<object, WeakMap<object, number | null>>();
const NO_ROUTE = {};
