import { computed, ref, watch } from "vue";
import { Browser, Events } from "@wailsio/runtime";
import {
  CheckAccessOffer,
  ClaimAccess,
  GetAccessOffer,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { AccessOffer } from "~/bindings/github.com/lagzap/lagzap/adapter/models";

// The beta or free trial claimed after joining LagZap's Discord. The server
// decides everything (coordinator/access_offer.go); this shows the offer,
// opens the Discord flow and sends the claim. Nothing is gated here beyond
// what the plan already does.

const POLL_MS = 5_000;

/** The offer as the service last read it from /data. */
const serviceOffer = ref<AccessOffer | null>(null);
/** The same offer from the app's own /data (sign-in and refreshes). */
const accountOffer = ref<AccessOffer | null>(null);
const offer = computed(() => serviceOffer.value ?? accountOffer.value);
/** The offer screen is open (also opened on its own once per run). */
const screenOpen = ref(false);
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
}

function maybeAutoOpen() {
  if (!autoOpened && offer.value && !offer.value.claimed) {
    autoOpened = true;
    screenOpen.value = true;
  }
}

export function useAccessOffer() {
  if (!listening) {
    listening = true;
    Events.On("access-offer", ({ data }) => {
      serviceOffer.value = ((Array.isArray(data) ? data[0] : data) as AccessOffer | null) ?? null;
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
    // Back from the browser's Discord flow: look at once.
    window.addEventListener("focus", () => {
      if (offer.value && (!offer.value.claimed || offer.value.suspended)) void check();
    });
    const user = useSanctumUser<DataResponse>();
    watch(
      () => user.value?.access_offer ?? null,
      (o) => {
        accountOffer.value = o;
        maybeAutoOpen();
      },
      { immediate: true },
    );
    // Suspended access returns by itself once the user rejoins: keep
    // looking so it shows without a restart.
    watch(suspended, (on) => {
      if (on && !suspendedPoll) {
        suspendedPoll = setInterval(() => void check(), POLL_MS);
      } else if (!on && suspendedPoll) {
        clearInterval(suspendedPoll);
        suspendedPoll = undefined;
      }
    });
    void GetAccessOffer()
      .then((o) => {
        serviceOffer.value = o ?? null;
        maybeAutoOpen();
      })
      .catch(() => {});
  }

  /** There is an offer the user has not claimed. */
  const open = computed(() => !!offer.value && !offer.value.claimed);
  const discordDone = computed(() => !!offer.value?.discord.linked && !!offer.value?.discord.member);

  const startPolling = () => {
    if (poll) return;
    void check();
    poll = setInterval(() => void check(), POLL_MS);
  };
  const stopPolling = () => {
    if (poll) clearInterval(poll);
    poll = undefined;
  };

  const connectDiscord = () => {
    const url = offer.value?.discord.link_url;
    if (url) void Browser.OpenURL(url);
  };

  /** Claims the offer; returns "" on success, else the refusal code. */
  const claim = async (): Promise<string> => {
    const campaign = offer.value?.campaign;
    if (!campaign) return "unreachable";
    const result = await ClaimAccess(campaign);
    await check();
    return result.ok ? "" : result.code || "unreachable";
  };

  return { offer, open, suspended, screenOpen, discordDone, startPolling, stopPolling, connectDiscord, claim, check };
}
