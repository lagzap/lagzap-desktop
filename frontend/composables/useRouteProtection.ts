/** Profiles LagZap just moved off a path that stopped working (a dead edge,
 * or a standby taking over), for the note on their card. Recorded by
 * components/network/RouteProtectedNotice.vue from "relay-path" events. */
const SHOW_MS = 60_000;

const recent = ref<Record<string, number>>({});

export function useRouteProtection() {
  return {
    recent,
    mark(profileId: string) {
      const at = Date.now();
      recent.value = { ...recent.value, [profileId]: at };
      setTimeout(() => {
        if (recent.value[profileId] === at) {
          const { [profileId]: _, ...rest } = recent.value;
          recent.value = rest;
        }
      }, SHOW_MS);
    },
  };
}
