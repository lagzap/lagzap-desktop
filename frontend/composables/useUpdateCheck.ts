import { Events } from "@wailsio/runtime";
import { CheckForUpdates } from "~/bindings/github.com/lagzap/lagzap-desktop/service";

const checking = ref(false);
const error = ref("");

let listenersReady = false;
let timeout: ReturnType<typeof setTimeout> | undefined;

function updaterPayload(data: unknown): { message?: string } | null {
  if (!data || typeof data !== "object") return null;
  const wrapped = data as { data?: unknown };
  const payload = wrapped.data ?? data;
  if (!payload || typeof payload !== "object") return null;
  return payload as { message?: string };
}

function finishCheck() {
  checking.value = false;
  if (timeout) {
    clearTimeout(timeout);
    timeout = undefined;
  }
}

function ensureListeners(fallbackError: string) {
  if (listenersReady) return;
  listenersReady = true;

  Events.On("wails:updater:no-update", () => {
    finishCheck();
    error.value = "";
  });
  Events.On("wails:updater:update-available", () => {
    finishCheck();
    error.value = "";
  });
  Events.On("wails:updater:error", ({ data }) => {
    finishCheck();
    error.value = updaterPayload(data)?.message || fallbackError;
  });
}

export function useUpdateCheck(t: (key: string) => string) {
  ensureListeners(t("$vuetify.settings.updateCheckFailed"));

  async function checkForUpdate() {
    if (checking.value) return;
    checking.value = true;
    error.value = "";

    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (!checking.value) return;
      finishCheck();
      error.value = t("$vuetify.settings.updateCheckTimedOut");
    }, 120_000);

    try {
      await CheckForUpdates();
    } catch (e) {
      finishCheck();
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  return { checking, error, checkForUpdate };
}
