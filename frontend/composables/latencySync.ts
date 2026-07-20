import { Events } from "@wailsio/runtime";
import type { MultiInterfaceLatency } from "~/composables/useLatencyMetrics";
import type { LatencyPingCache } from "~/composables/pingChartCache";

export const LATENCY_BROADCAST_CHANNEL = "lagzap-latency";

export interface LatencyBroadcastPayload {
  latency: MultiInterfaceLatency;
  latencyPingCache: LatencyPingCache;
}

type LatencyBroadcastMessage =
  | { type: "snapshot"; payload: LatencyBroadcastPayload }
  | { type: "update"; payload: MultiInterfaceLatency };

let broadcastChannel: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") {
    return null;
  }
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel(LATENCY_BROADCAST_CHANNEL);
  }
  return broadcastChannel;
}

export function isLatencyOverlayRoute(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.location.pathname.startsWith("/latency-overlay");
}

export function publishLatencyUpdate(latency: MultiInterfaceLatency) {
  getBroadcastChannel()?.postMessage({
    type: "update",
    payload: latency,
  } satisfies LatencyBroadcastMessage);
}

export function publishLatencySnapshot(payload: LatencyBroadcastPayload) {
  getBroadcastChannel()?.postMessage({
    type: "snapshot",
    payload: JSON.parse(JSON.stringify(payload)) as LatencyBroadcastPayload,
  } satisfies LatencyBroadcastMessage);
}

export function subscribeLatencyBroadcast(handlers: {
  onSnapshot?: (payload: LatencyBroadcastPayload) => void;
  onUpdate?: (latency: MultiInterfaceLatency) => void;
}): () => void {
  const channel = getBroadcastChannel();
  if (!channel) {
    return () => undefined;
  }

  const listener = (event: MessageEvent<LatencyBroadcastMessage>) => {
    const message = event.data;
    if (!message?.type) {
      return;
    }
    if (message.type === "snapshot") {
      handlers.onSnapshot?.(message.payload);
      return;
    }
    if (message.type === "update") {
      handlers.onUpdate?.(message.payload);
    }
  };

  channel.addEventListener("message", listener);
  return () => channel.removeEventListener("message", listener);
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
