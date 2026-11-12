// The Discord free trial's rules, kept apart from Vue so they can be tested
// alone (tests/accessOffer.test.ts). The server decides everything; these only
// say what to show.

/** How often /data is fetched while the Discord login is open in the browser. */
export const DISCORD_WAIT_POLL_MS = 3_000;

/** LagZap's Discord server, for "Rejoin our Discord" (an invite that never
 * expires; the same one as discord_presence.go). */
export const DISCORD_INVITE_URL = "https://discord.gg/spshhDFcbw";

/** Reasons with their own text (accessOffer.blocked.*); any other is "other". */
export const OFFER_REASONS = [
  "no_campaign",
  "discord_unavailable",
  "has_plan",
  "account_used",
  "device_used",
  "discord_used",
  "discord_too_new",
  "unknown_device",
  "revoked",
  "unreachable",
] as const;

/** The i18n key under $vuetify.accessOffer.blocked for a refusal code. */
export function reasonKey(code: string | null | undefined): string {
  if (!code) return "";
  return (OFFER_REASONS as readonly string[]).includes(code) ? code : "other";
}

interface OfferLike {
  can_start?: boolean;
  claimed?: boolean;
}

/** "Get a free trial with Discord" is shown. */
export function canStartOffer(o: OfferLike | null | undefined): boolean {
  return !!o && !!o.can_start && !o.claimed;
}

/** While the Discord login is open: "waiting" keeps polling, "done" when the
 * offer was granted, "expired" once the login's time is up. */
export type DiscordWait = "waiting" | "done" | "expired";

export function discordWait(o: OfferLike | null | undefined, expiresAtMs: number, nowMs: number): DiscordWait {
  if (o?.claimed) return "done";
  if (!Number.isFinite(expiresAtMs) || nowMs >= expiresAtMs) return "expired";
  return "waiting";
}

/** expires_at from the start reply in Unix ms; a missing or bad one gives the
 * login its 10 minutes from now. */
export function loginExpiry(expiresAt: string | null | undefined, nowMs: number): number {
  const ms = expiresAt ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(ms) ? ms : nowMs + 10 * 60_000;
}
