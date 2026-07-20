import type { NodeRoute, RelayRoute } from "~/bindings/github.com/lagzap/zap/data";
import {
  bestRouteRelayLatency,
  nodeRoutePathKey,
  routeRelayLatency,
} from "~/composables/useProfileDisplayRoutes";
import type { RouteProbeEvent } from "~/types/monitoring";

/** Prefer measured RTT; hop-sum only when no min/avg is available. */
export function routeDisplayLatency(route: NodeRoute | null | undefined): number {
  if (!route) {
    return 0;
  }
  const measured = route.min_latency || route.avg_latency || 0;
  if (measured > 0) {
    return measured;
  }
  return routeRelayLatency(route);
}

export function bestRouteDisplayLatency(
  routes: NodeRoute[] | null | undefined
): { ping: number; score: number; route: NodeRoute | null } {
  let best: { ping: number; score: number; route: NodeRoute | null } = {
    ping: 0,
    score: 0,
    route: null,
  };
  if (!routes?.length) {
    return best;
  }
  for (const route of routes) {
    const ping = routeDisplayLatency(route);
    if (ping <= 0) {
      continue;
    }
    if (best.ping === 0 || ping < best.ping) {
      best = { ping, score: route.score || 0, route };
    }
  }
  // Fall back to hop-sum helper if nothing measured.
  if (best.ping <= 0) {
    return bestRouteRelayLatency(routes);
  }
  return best;
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
      for (const slot of slots) {
        if (!(slot.latency > 0)) {
          continue;
        }
        if (slot.path_key && pathKey && slot.path_key !== pathKey) {
          continue;
        }
        if (best == null || slot.latency < best) {
          best = slot.latency;
        }
      }
    }
  }
  if (best == null) {
    for (const slot of slots) {
      if (!(slot.latency > 0)) {
        continue;
      }
      if (best == null || slot.latency < best) {
        best = slot.latency;
      }
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
