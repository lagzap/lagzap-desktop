import { useStore } from "@/stores";
import { useProfileChart } from "~/composables/useProfileChart";
import { useNodeLocationLabel } from "~/composables/useNodeLocationLabel";

export type RouteLineStop = {
  /** The server's city (or address label). */
  label: string;
  /** The leg into this stop in ms; 0 direct, -1 not measured. */
  ms: number;
};

/** The profile's best route as stops: You → each server → the game (the
 * predicted one while idle). Empty while there is none (only a preview). */
export function useRouteLine(profileId: string) {
  const store = useStore();
  const { chart } = useProfileChart(profileId);
  const { getNodeLabelByIp } = useNodeLocationLabel();

  const liveRoutes = computed(() => (chart.value?.diagram?.best?.routes ?? []).filter((r) => !r.planned));
  /** How many routes carry the game at once (Multi Internet, several paths). */
  const routeCount = computed(() => liveRoutes.value.length);

  const route = computed(() => {
    const d = chart.value?.diagram;
    if (!d?.show) return null;
    return liveRoutes.value[d.best?.estimate?.best ?? -1] ?? liveRoutes.value[0] ?? null;
  });

  const stops = computed<RouteLineStop[]>(() =>
    (route.value?.hops ?? []).map((hop, i) => {
      const node = hop.node_id ? store.nodes[hop.node_id] : undefined;
      const label = node ? String(store.localized(node.city) || node.name) : getNodeLabelByIp(hop.ip);
      // The first leg can be direct (0); a server-to-server leg never is.
      const ms = i === 0 ? (hop.latency >= 0 ? hop.latency : -1) : hop.latency > 0 ? hop.latency : -1;
      return { label, ms };
    }),
  );

  /** The internets the live session uses, when more than one. */
  const internets = computed(() => {
    const names = chart.value?.diagram?.session?.internets ?? [];
    return names.length > 1 ? names.length : 0;
  });

  /** How the last server reaches the game: "UDP v4" (the live session's,
   * else the best route's network; the version from its address). */
  const transport = computed(() => {
    const session = chart.value?.diagram?.session;
    const net = session?.network || route.value?.network || "";
    if (!net) return "";
    const hops = route.value?.hops ?? [];
    const ip = hops[hops.length - 1]?.ip ?? "";
    const version = session?.ip_version ? session.ip_version : ip ? (ip.includes(":") ? 6 : 4) : 0;
    return `${net.toUpperCase()}${version ? ` v${version}` : ""}`;
  });

  /** Where the game's traffic leaves LagZap: the last server's city. */
  const exitCity = computed(() => stops.value[stops.value.length - 1]?.label ?? "");
  return { stops, internets, exitCity, transport, routeCount };
}
