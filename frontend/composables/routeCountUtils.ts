export const MAX_ROUTES = 4

export const DEFAULT_TCP_ROUTES = 0
export const DEFAULT_UDP_ROUTES = 2

export interface RouteCountPair {
  tcp: number | null
  udp: number | null
}

export function normalizeRouteCounts(
  tcp: number | null,
  udp: number | null,
  changed: 'tcp' | 'udp',
): RouteCountPair {
  if (tcp === null && udp === null) {
    return { tcp: null, udp: null }
  }

  let nextTcp = tcp ?? DEFAULT_TCP_ROUTES
  let nextUdp = udp ?? DEFAULT_UDP_ROUTES

  nextTcp = Math.max(0, Math.min(MAX_ROUTES, Math.round(nextTcp) || 0))
  nextUdp = Math.max(0, Math.min(MAX_ROUTES, Math.round(nextUdp) || 0))

  const excess = nextTcp + nextUdp - MAX_ROUTES
  if (excess > 0) {
    if (changed === 'tcp') {
      nextUdp = Math.max(0, nextUdp - excess)
    } else {
      nextTcp = Math.max(0, nextTcp - excess)
    }
  }

  if (nextTcp + nextUdp < 1) {
    if (changed === 'tcp') {
      nextUdp = nextTcp === 0 ? 1 : nextTcp
      if (nextTcp === 0) {
        nextTcp = DEFAULT_TCP_ROUTES
      }
    } else if (nextUdp === 0) {
      nextTcp = 1
    } else {
      nextUdp = 1
    }
  }

  return { tcp: nextTcp, udp: nextUdp }
}

export function formatRouteDefaultLabel(
  tcp: number | null,
  udp: number | null,
  t: (key: string, params?: unknown[]) => string,
): string {
  const resolvedTcp = tcp ?? DEFAULT_TCP_ROUTES
  const resolvedUdp = udp ?? DEFAULT_UDP_ROUTES
  return t('$vuetify.settings.routeCounts.defaultValue', [resolvedTcp, resolvedUdp])
}
