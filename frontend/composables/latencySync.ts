import { Events } from "@wailsio/runtime";
import type { MultiInterfaceLatency } from "~/composables/useLatencyMetrics";

export function isLatencyOverlayRoute(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  // Hash mode: path is always "/" — route lives in the hash.
  const hash = window.location.hash.replace(/^#/, "") || "/";
  return hash.startsWith("/latency-overlay");
}

let backendLatencyRegistered = false;

export function registerBackendLatencyListener(
  onLatency: (data: MultiInterfaceLatency) => void
) {
  if (backendLatencyRegistered) {
    return;
  }
  backendLatencyRegistered = true;
  Events.On("latency", ({ data }) => {
    onLatency(data as MultiInterfaceLatency);
  });
}
