import { useStore } from "~/stores";
import {
  isNetworkHistoryConsentGranted,
  setNetworkHistoryConsent,
} from "~/utils/networkHistoryConsent";

/**
 * Admin-only opt-in for local network history recording.
 * Recording stays off until an admin explicitly grants permission.
 */
export function useNetworkHistoryConsent() {
  const store = useStore();
  const granted = ref(isNetworkHistoryConsentGranted());

  const isAdmin = computed(() => store.abilities.includes("admin"));
  const canRecord = computed(() => isAdmin.value && granted.value);
  const canAccessReport = computed(() => isAdmin.value);

  function setGranted(value: boolean) {
    setNetworkHistoryConsent(value);
    granted.value = value;
  }

  function syncFromStorage() {
    granted.value = isNetworkHistoryConsentGranted();
  }

  onMounted(() => {
    syncFromStorage();
    window.addEventListener(
      "lagzap-network-history-consent",
      syncFromStorage as EventListener
    );
    window.addEventListener("storage", syncFromStorage);
  });

  onUnmounted(() => {
    window.removeEventListener(
      "lagzap-network-history-consent",
      syncFromStorage as EventListener
    );
    window.removeEventListener("storage", syncFromStorage);
  });

  return {
    granted,
    isAdmin,
    canRecord,
    canAccessReport,
    setGranted,
  };
}
