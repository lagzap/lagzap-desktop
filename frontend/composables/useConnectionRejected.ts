import { ref } from "vue";
import { Events } from "@wailsio/runtime";

/** A profile's connection was rejected: no LagZap server in its location
 * selection could carry it, and LagZap never moves a game outside the user's
 * pick or straight to the game server ("connection-rejected"; Go tells once in
 * a while per profile). Shown as a banner at the top of the page; the user
 * turns the profile off, picks another location or closes it. */
export interface Rejection {
  profile_id: string;
  title_id: string;
  code: string;
  selection?: string;
  network: string;
}

const rejection = ref<Rejection | null>(null);
let listening = false;

/** Started once by the app, so a rejection is kept while no page shows the
 * banner. */
export function listenConnectionRejected() {
  if (listening) return;
  listening = true;
  Events.On("connection-rejected", ({ data }: any) => {
    const next = (Array.isArray(data) ? data[0] : data) as Rejection | undefined;
    if (next?.profile_id) rejection.value = next;
  });
}

export function useConnectionRejected() {
  return {
    rejection,
    dismiss: () => {
      rejection.value = null;
    },
  };
}
