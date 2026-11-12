import { computed, ref, watch } from "vue";
import { Browser, Events } from "@wailsio/runtime";
import {
  CheckAccessOffer,
  GetAccessOffer,
  StartDiscordTrial,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { AccessOffer } from "~/bindings/github.com/lagzap/lagzap/adapter/models";
import {
  DISCORD_INVITE_URL,
  DISCORD_WAIT_POLL_MS,
  canStartOffer,
  discordWait,
  loginExpiry,
} from "~/utils/accessOffer";

// The beta or free trial through LagZap's Discord. The server decides
// everything (coordinator/access_offer.go): the app asks for the Discord login,
// opens it in the browser, and polls /data until the plan has started. There
// is no push for it and no way back into the app from the browser.

const SUSPENDED_POLL_MS = 5_000;

/** The offer as the service last read it from /data. */
const serviceOffer = ref<AccessOffer | null>(null);
/** The same offer from the app's own /data (sign-in and refreshes). */
const accountOffer = ref<AccessOffer | null>(null);
const offer = computed(() => serviceOffer.value ?? accountOffer.value);
/** The offer screen is open (also opened on its own once per run). */
const screenOpen = ref(false);
/** The Discord login open in the browser: its URL and when it runs out
 * (null: not waiting on one). */
const login = ref<{ url: string; expiresAtMs: number } | null>(null);
/** The last login ran out without the plan starting. */
const loginExpired = ref(false);
let autoOpened = false;
let listening = false;
let poll: ReturnType<typeof setInterval> | undefined;
let suspendedPoll: ReturnType<typeof setInterval> | undefined;

/** Claimed access paused because the user left the Discord server. */
const suspended = computed(() => !!offer.value?.suspended);

async function check() {
  try {
    serviceOffer.value = (await CheckAccessOffer()) ?? null;
  } catch {
    // service not running yet
  }
  settleLogin();
}

/** Stops waiting once the plan has started or the login ran out. */
function settleLogin() {
  if (!login.value) return;
  const state = discordWait(offer.value, login.value.expiresAtMs, Date.now());
  if (state === "waiting") return;
  stopWaiting();
  if (state === "done") {
    screenOpen.value = false;
  } else {
    loginExpired.value = true;
  }
}

function stopWaiting() {
  login.value = null;
  if (poll) clearInterval(poll);
  poll = undefined;
}

function maybeAutoOpen() {
  if (!autoOpened && canStartOffer(offer.value)) {
    autoOpened = true;
    screenOpen.value = true;
  }
}

export function useAccessOffer() {
  if (!listening) {
    listening = true;
    Events.On("access-offer", ({ data }) => {
      serviceOffer.value = ((Array.isArray(data) ? data[0] : data) as AccessOffer | null) ?? null;
      settleLogin();
      maybeAutoOpen();
    });
    Events.On("service-started", async () => {
      try {
        serviceOffer.value = (await GetAccessOffer()) ?? null;
        maybeAutoOpen();
      } catch {
        // not ready
      }
    });
    // Back from the browser: look at once.
    window.addEventListener("focus", () => {
      if (login.value || offer.value?.suspended) void check();
    });
    const user = useSanctumUser<DataResponse>();
    watch(
      () => user.value?.access_offer ?? null,
      (o) => {
        accountOffer.value = o;
        settleLogin();
        maybeAutoOpen();
      },
      { immediate: true },
    );
    // Suspended access returns by itself once the user rejoins: keep
    // looking so it shows without a restart.
    watch(suspended, (on) => {
      if (on && !suspendedPoll) {
        suspendedPoll = setInterval(() => void check(), SUSPENDED_POLL_MS);
      } else if (!on && suspendedPoll) {
        clearInterval(suspendedPoll);
        suspendedPoll = undefined;
      }
    });
    // Closing the screen stops waiting on the browser.
    watch(screenOpen, (open) => {
      if (!open) {
        stopWaiting();
        loginExpired.value = false;
      }
    });
    void GetAccessOffer()
      .then((o) => {
        serviceOffer.value = o ?? null;
        maybeAutoOpen();
      })
      .catch(() => {});
  }

  /** "Get a free trial with Discord" can be shown. */
  const open = computed(() => canStartOffer(offer.value));
  const waiting = computed(() => !!login.value);

  /** Asks for a new Discord login (each try gets its own, valid once) and
   * opens it in the browser; returns "" when it opened, else the refusal. */
  const startDiscord = async (): Promise<string> => {
    stopWaiting();
    loginExpired.value = false;
    let result;
    try {
      result = await StartDiscordTrial();
    } catch {
      return "unreachable";
    }
    if (result.code || !result.url) {
      // The offer may have changed (a plan, a used computer): show it.
      void check();
      return result.code || "unreachable";
    }
    login.value = { url: result.url, expiresAtMs: loginExpiry(result.expires_at, Date.now()) };
    void Browser.OpenURL(result.url);
    poll = setInterval(() => void check(), DISCORD_WAIT_POLL_MS);
    return "";
  };

  /** Opens the same Discord login again (the browser tab was closed). */
  const reopenLogin = () => {
    if (login.value) void Browser.OpenURL(login.value.url);
  };

  const openDiscordServer = () => void Browser.OpenURL(DISCORD_INVITE_URL);

  return {
    offer,
    open,
    suspended,
    screenOpen,
    waiting,
    loginExpired,
    startDiscord,
    reopenLogin,
    openDiscordServer,
    check,
  };
}
