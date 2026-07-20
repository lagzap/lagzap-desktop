import {
  CloseLatencyOverlay,
  IsLatencyOverlayOpen,
  OpenLatencyOverlay,
  SetLatencyOverlayAlwaysOnTop,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";

/** Open or focus the frameless latency pop-out window. */
export function openLatencyOverlay() {
  return OpenLatencyOverlay();
}

/** Close the pop-out and dock latency back into the main UI. */
export function closeLatencyOverlay() {
  return CloseLatencyOverlay();
}

export function isLatencyOverlayOpen() {
  return IsLatencyOverlayOpen();
}

export function setLatencyOverlayAlwaysOnTop(alwaysOnTop: boolean) {
  return SetLatencyOverlayAlwaysOnTop(alwaysOnTop);
}

const OPACITY_KEY = "cyrex.latencyOverlay.opacity";
const ALWAYS_ON_TOP_KEY = "cyrex.latencyOverlay.alwaysOnTop";

export function loadOverlayOpacity(): number {
  if (typeof localStorage === "undefined") {
    return 0.92;
  }
  const raw = localStorage.getItem(OPACITY_KEY);
  const value = raw != null ? Number(raw) : NaN;
  if (!Number.isFinite(value)) {
    return 0.92;
  }
  return Math.min(1, Math.max(0.35, value));
}

export function saveOverlayOpacity(opacity: number) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(OPACITY_KEY, String(opacity));
}

export function loadOverlayAlwaysOnTop(): boolean {
  if (typeof localStorage === "undefined") {
    return true;
  }
  const raw = localStorage.getItem(ALWAYS_ON_TOP_KEY);
  if (raw == null) {
    return true;
  }
  return raw !== "0" && raw !== "false";
}

export function saveOverlayAlwaysOnTop(value: boolean) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(ALWAYS_ON_TOP_KEY, value ? "1" : "0");
}
