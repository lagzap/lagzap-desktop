import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import { ProfileFlag } from "~/constants/profile";
import { DEFAULT_TCP_ROUTES, DEFAULT_UDP_ROUTES, resolveProfileRouteCounts } from "~/composables/routeCountUtils";
import { useNetworkAdapterSettings } from "~/composables/useNetworkAdapterSettings";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { useStore } from "@/stores";

/** Whether a game profile's multipath is off (one leg in all), and whether
 * its plan allows the two routes that would turn it on. */
export function useProfileMultipath(profile: () => Profile) {
  const store = useStore();
  const plan = usePlanAccess();
  const { resolvedGlobalTcp, resolvedGlobalUdp, multiInternetSelection, effectiveTcpForInterface, effectiveUdpForInterface } =
    useNetworkAdapterSettings();

  const state = () => store.profileStates[profile().id];
  const customRoutes = computed(() => {
    const s = state();
    return s?.route_connections != null || s?.tcp_connections != null || s?.udp_connections != null;
  });
  const totalRoutes = computed(
    () =>
      resolveProfileRouteCounts(state(), {
        tcp: resolvedGlobalTcp.value ?? DEFAULT_TCP_ROUTES,
        udp: resolvedGlobalUdp.value ?? DEFAULT_UDP_ROUTES,
      }).total,
  );

  // Multi Internet opens the routes on every adapter it uses: the profile's
  // own adapter list, else the Multi Internet adapters. One route on two
  // adapters is two legs, still multipath; multipath is off only with one
  // leg in all.
  const adapters = computed(() => {
    if ((profile().flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET)) === 0) return [];
    const present = store.availableInterfaceNames;
    const own = (state()?.network_interfaces ?? []).filter((name) => present.includes(name));
    return own.length ? own : multiInternetSelection.value;
  });
  const legs = computed(() => {
    const names = adapters.value;
    if (names.length === 0) return totalRoutes.value;
    // The profile's counts apply on each adapter; without them each adapter
    // uses its own Multi Internet counts.
    if (customRoutes.value) return totalRoutes.value * names.length;
    return names.reduce((sum, name) => sum + effectiveTcpForInterface(name) + effectiveUdpForInterface(name), 0);
  });

  const multipathOff = computed(() => legs.value <= 1);
  /** The plan lets a profile use two routes (no active plan: it does not). */
  const routesInPlan = computed(() => {
    if (plan.admin.value) return true;
    const max = plan.limits.value?.max_routes ?? 0;
    return plan.active.value && (max === 0 || max >= 2);
  });

  return { adapters, multipathOff, routesInPlan };
}
