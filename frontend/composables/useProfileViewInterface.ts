import { computed, ref, toValue, type MaybeRefOrGetter, type Ref } from "vue";

/** Visual-only interface filter for profile diagram + latency chart. */
export const BEST_INTERFACE = "best";

const selectionByProfile = new Map<string, Ref<string>>();
const chartConnectionByProfile = new Map<string, Ref<string | null>>();

function interfaceSelectionRef(profileId: string): Ref<string> {
  let selected = selectionByProfile.get(profileId);
  if (!selected) {
    selected = ref(BEST_INTERFACE);
    selectionByProfile.set(profileId, selected);
  }
  return selected;
}

function chartConnectionSelectionRef(profileId: string): Ref<string | null> {
  let selected = chartConnectionByProfile.get(profileId);
  if (!selected) {
    selected = ref<string | null>(null);
    chartConnectionByProfile.set(profileId, selected);
  }
  return selected;
}

export function useProfileViewInterface(profileId: string) {
  const selectedInterfaceKey = interfaceSelectionRef(profileId);
  const selectedConnectionId = chartConnectionSelectionRef(profileId);

  const isBestInterface = computed(
    () => selectedInterfaceKey.value === BEST_INTERFACE
  );

  /** Pin a connection for the latency chart; pass null to return to auto top. */
  function selectConnectionForChart(connectionId: string | null) {
    selectedConnectionId.value = connectionId;
  }

  /** Click again on the active row to clear the pin. */
  function toggleConnectionForChart(connectionId: string) {
    selectedConnectionId.value =
      selectedConnectionId.value === connectionId ? null : connectionId;
  }

  return {
    BEST_INTERFACE,
    selectedInterfaceKey,
    isBestInterface,
    selectedConnectionId,
    selectConnectionForChart,
    toggleConnectionForChart,
  };
}

/** Shared chart-connection pin for a profile id that may change with the ref. */
export function useProfileChartConnection(
  profileId: MaybeRefOrGetter<string>
) {
  const selectedConnectionId = computed({
    get(): string | null {
      const id = toValue(profileId);
      if (!id) {
        return null;
      }
      return chartConnectionSelectionRef(id).value;
    },
    set(connectionId: string | null) {
      const id = toValue(profileId);
      if (!id) {
        return;
      }
      chartConnectionSelectionRef(id).value = connectionId;
    },
  });

  function toggleConnectionForChart(connectionId: string) {
    selectedConnectionId.value =
      selectedConnectionId.value === connectionId ? null : connectionId;
  }

  return {
    selectedConnectionId,
    toggleConnectionForChart,
    selectConnectionForChart: (connectionId: string | null) => {
      selectedConnectionId.value = connectionId;
    },
  };
}
