/**
 * Opt-in gate for on-device network history / report recording.
 * Default is off — nothing is stored until the user explicitly enables it.
 */

export const NETWORK_HISTORY_CONSENT_KEY = "lagzap-network-history-consent";

export function isNetworkHistoryConsentGranted(): boolean {
  if (typeof localStorage === "undefined") {
    return false;
  }
  try {
    return localStorage.getItem(NETWORK_HISTORY_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setNetworkHistoryConsent(granted: boolean): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    if (granted) {
      localStorage.setItem(NETWORK_HISTORY_CONSENT_KEY, "1");
    } else {
      localStorage.removeItem(NETWORK_HISTORY_CONSENT_KEY);
    }
  } catch {
    // ignore quota / private mode
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("lagzap-network-history-consent", {
        detail: { granted },
      })
    );
  }
}
