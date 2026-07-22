import { computed, ref, type Ref } from "vue";

/** Visual-only interface filter for profile diagram + latency chart. */
export const BEST_INTERFACE = "best";

const selectionByProfile = new Map<string, Ref<string>>();

export function useProfileViewInterface(profileId: string) {
  let selectedInterfaceKey = selectionByProfile.get(profileId);
  if (!selectedInterfaceKey) {
    selectedInterfaceKey = ref(BEST_INTERFACE);
    selectionByProfile.set(profileId, selectedInterfaceKey);
  }

  const isBestInterface = computed(
    () => selectedInterfaceKey!.value === BEST_INTERFACE
  );

  return {
    BEST_INTERFACE,
    selectedInterfaceKey,
    isBestInterface,
  };
}
