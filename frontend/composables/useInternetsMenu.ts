// A tip's Set up opens the profile's location menu on its internets (Multi
// Internet or Load balancing) instead of leaving the page. The menu watches
// for its profile's request.
const requests = reactive<Record<string, number>>({});

/** Opens profileId's location menu with its internets highlighted. */
export function openInternetsMenu(profileId: string) {
  requests[profileId] = Date.now();
}

/** Changes each time the menu of profileId is asked to open (0: never). */
export function useInternetsMenuRequest(profileId: () => string) {
  return computed(() => requests[profileId()] ?? 0);
}
