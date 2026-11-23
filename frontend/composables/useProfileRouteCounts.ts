import { computed } from "vue";
import { useStore } from "@/stores";
import {
  MAX_ROUTES,
  DEFAULT_TCP_ROUTES,
  DEFAULT_UDP_ROUTES,
  normalizeRouteCounts,
  resolveProfileRouteCounts,
} from "~/composables/routeCountUtils";
import { useNetworkAdapterSettings } from "~/composables/useNetworkAdapterSettings";
import { usePlanAccess } from "~/composables/usePlanAccess";
import type { ProfileState } from "~/bindings/github.com/lagzap/zap/data";

/** A profile's route counts: the Smart cap (one total, the coordinator
 * splits it) or a TCP/UDP split of its own, else the adapters' defaults.
 * Route Settings and the title page's top bar both edit them. `target`:
 * another state to edit instead (the title's). */
export function useProfileRouteCounts(
  profileId: () => string,
  target?: () => Partial<ProfileState> | undefined,
) {
  const store = useStore();
  const plan = usePlanAccess();

  /** The plan's route limit, within what the inputs offer anyway. */
  const routeMax = computed(() => {
    const max = plan.limits.value?.max_routes ?? 0;
    return max > 0 ? Math.min(MAX_ROUTES, max) : MAX_ROUTES;
  });

  const { resolvedGlobalTcp: defaultTcpRoutes, resolvedGlobalUdp: defaultUdpRoutes, ensureLoaded } =
    useNetworkAdapterSettings();

  const state = (): Partial<ProfileState> | undefined => (target ? target() : store.profileStates[profileId()]);

  const profileUsesCustomRoutes = computed(() => {
    const st = state();
    return st?.route_connections != null || st?.tcp_connections != null || st?.udp_connections != null;
  });

  /** Simple mode: persist unified cap; coordinator allocates TCP/UDP. */
  function applySimpleRouteCap(total: number | null) {
    const st = state();
    if (!st) return;
    delete st.tcp_connections;
    delete st.udp_connections;
    delete st.relay_transport_fallback;
    if (total === null) {
      delete st.route_connections;
      return;
    }
    st.route_connections = Math.max(1, Math.min(MAX_ROUTES, Math.round(total) || 1));
  }

  function applyRouteCounts(tcp: number | null, udp: number | null, changed: "tcp" | "udp") {
    const st = state();
    if (!st) return;
    // Advanced explicit split replaces unified cap.
    delete st.route_connections;
    if (changed === "tcp" && tcp === null) {
      delete st.tcp_connections;
      return;
    }
    if (changed === "udp" && udp === null) {
      delete st.udp_connections;
      return;
    }
    const nextTcp = tcp ?? st.tcp_connections ?? defaultTcpRoutes.value;
    const nextUdp = udp ?? st.udp_connections ?? defaultUdpRoutes.value;
    const normalized = normalizeRouteCounts(nextTcp, nextUdp, changed);
    if (normalized.tcp !== null) st.tcp_connections = normalized.tcp;
    else delete st.tcp_connections;
    if (normalized.udp !== null) st.udp_connections = normalized.udp;
    else delete st.udp_connections;
  }

  const resolvedCounts = computed(() =>
    resolveProfileRouteCounts(state() as ProfileState | undefined, {
      tcp: defaultTcpRoutes.value ?? DEFAULT_TCP_ROUTES,
      udp: defaultUdpRoutes.value ?? DEFAULT_UDP_ROUTES,
    }),
  );

  /** Always the effective counts (profile override or settings default). */
  const tcpRoutes = computed({
    get: () => resolvedCounts.value.tcp,
    set: (value: number | null) => {
      if (value === null) {
        applyRouteCounts(null, state()?.udp_connections ?? null, "tcp");
        return;
      }
      applyRouteCounts(value, state()?.udp_connections ?? defaultUdpRoutes.value, "tcp");
    },
  });
  const udpRoutes = computed({
    get: () => resolvedCounts.value.udp,
    set: (value: number | null) => {
      if (value === null) {
        applyRouteCounts(state()?.tcp_connections ?? null, null, "udp");
        return;
      }
      applyRouteCounts(state()?.tcp_connections ?? defaultTcpRoutes.value, value, "udp");
    },
  });

  /** One of the two always carries at least one route. */
  const tcpRoutesMin = computed(() => (profileUsesCustomRoutes.value && udpRoutes.value === 0 ? 1 : 0));
  const udpRoutesMin = computed(() => (profileUsesCustomRoutes.value && tcpRoutes.value === 0 ? 1 : 0));

  return {
    routeMax,
    ensureLoaded,
    profileUsesCustomRoutes,
    applySimpleRouteCap,
    applyRouteCounts,
    resolvedCounts,
    tcpRoutes,
    udpRoutes,
    tcpRoutesMin,
    udpRoutesMin,
  };
}
