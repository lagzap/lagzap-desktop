import {
  AdminToolsEnabled,
  CloseAdminTools,
  IsAdminToolsOpen,
  OpenAdminTools,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";

/** Open or focus the Admin Tools window (dev/alpha builds only). */
export function openAdminTools() {
  return OpenAdminTools();
}

/** Close the Admin Tools window. */
export function closeAdminTools() {
  return CloseAdminTools();
}

export function isAdminToolsOpen() {
  return IsAdminToolsOpen();
}

/** Whether this build exposes Admin Tools (tray + routes). */
export async function adminToolsAvailable(): Promise<boolean> {
  try {
    return !!(await AdminToolsEnabled());
  } catch {
    return false;
  }
}
