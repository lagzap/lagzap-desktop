import { Events } from "@wailsio/runtime";
import { CheckForUpdates } from "~/bindings/github.com/lagzap/lagzap-desktop/service";

export type UpdateCheckStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "error";

const checking = ref(false);
const dialogOpen = ref(false);
const status = ref<UpdateCheckStatus>("idle");
const error = ref("");

let listenersReady = false;
let timeout: ReturnType<typeof setTimeout> | undefined;
let upToDateCloseTimer: ReturnType<typeof setTimeout> | undefined;
let fallbackError = "Could not check for updates";

function updaterPayload(data: unknown): { message?: string } | null {
  if (!data || typeof data !== "object") return null;
  const wrapped = data as { data?: unknown };
  const payload = wrapped.data ?? data;
  if (!payload || typeof payload !== "object") return null;
  return payload as { message?: string };
}

function clearTimers() {
  if (timeout) {
    clearTimeout(timeout);
    timeout = undefined;
  }
  if (upToDateCloseTimer) {
    clearTimeout(upToDateCloseTimer);
    upToDateCloseTimer = undefined;
  }
}

function finishCheck(next: UpdateCheckStatus, message = "") {
  checking.value = false;
  clearTimers();
  status.value = next;
  error.value = message;

  if (next === "idle") {
    dialogOpen.value = false;
    return;
  }

  if (next === "up-to-date") {
    dialogOpen.value = true;
    upToDateCloseTimer = setTimeout(() => {
      dismissUpdateCheck();
    }, 1800);
    return;
  }

  // error: keep dialog open until dismissed
  dialogOpen.value = true;
}

function dismissUpdateCheck() {
  clearTimers();
  checking.value = false;
  dialogOpen.value = false;
  status.value = "idle";
  error.value = "";
}

function ensureListeners() {
  if (listenersReady) return;
  listenersReady = true;

  Events.On("wails:updater:no-update", () => {
    if (!checking.value && status.value !== "checking") return;
    finishCheck("up-to-date");
  });
  Events.On("wails:updater:update-available", () => {
    // Native updater window takes over.
    finishCheck("idle");
  });
  Events.On("wails:updater:error", ({ data }) => {
    if (!checking.value && status.value !== "checking") return;
    finishCheck(
      "error",
      updaterPayload(data)?.message || fallbackError,
    );
  });
}

export function useUpdateCheck(t: (key: string) => string) {
  fallbackError = t("$vuetify.settings.updateCheckFailed");
  ensureListeners();

  async function checkForUpdate() {
    if (checking.value) return;
    clearTimers();
    checking.value = true;
    status.value = "checking";
    error.value = "";
    dialogOpen.value = true;

    timeout = setTimeout(() => {
      if (!checking.value) return;
      finishCheck(
        "error",
        t("$vuetify.settings.updateCheckTimedOut"),
      );
    }, 120_000);

    try {
      await CheckForUpdates();
    } catch (e) {
      finishCheck(
        "error",
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  return {
    checking,
    dialogOpen,
    status,
    error,
    checkForUpdate,
    dismissUpdateCheck,
  };
}
