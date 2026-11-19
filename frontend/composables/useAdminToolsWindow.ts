import {
  AdminToolsEnabled,
  CloseAdminTools,
  IsAdminToolsOpen,
  OpenAdminTools,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";

/** Open or focus the Admin Tools window (dev/alpha builds, or an admin account). */
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

/** Whether Admin Tools are open to this build or account (routes). */
export async function adminToolsAvailable(): Promise<boolean> {
  try {
    return !!(await AdminToolsEnabled());
  } catch {
    return false;
  }
}
