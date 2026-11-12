import { describe, expect, test } from "bun:test";
import { canStartOffer, discordWait, loginExpiry, reasonKey } from "../utils/accessOffer";
import en from "../i18n/locales/en.js";
import fa from "../i18n/locales/fa.js";

const REASONS = [
  "no_campaign",
  "has_plan",
  "account_used",
  "device_used",
  "unknown_device",
  "discord_unavailable",
  "discord_used",
  "discord_too_new",
  "revoked",
  "unreachable",
];

describe("reason codes", () => {
  test("each server reason has its own text in every language", () => {
    for (const code of REASONS) {
      expect(reasonKey(code)).toBe(code);
      for (const messages of [en, fa]) {
        expect((messages as any).accessOffer.blocked[code]).toBeString();
      }
    }
  });
  test("an unknown reason falls back to other, none to nothing", () => {
    expect(reasonKey("discord_join_failed")).toBe("other");
    expect(reasonKey("")).toBe("");
    expect(reasonKey(null)).toBe("");
    expect((en as any).accessOffer.blocked.other).toBeString();
    expect((fa as any).accessOffer.blocked.other).toBeString();
  });
});

describe("button", () => {
  test("shown on can_start alone", () => {
    expect(canStartOffer({ can_start: true, claimed: false })).toBe(true);
    expect(canStartOffer({ can_start: false, claimed: false })).toBe(false);
    expect(canStartOffer({ can_start: true, claimed: true })).toBe(false);
    expect(canStartOffer(null)).toBe(false);
  });
});

describe("waiting on the browser", () => {
  const expires = Date.parse("2026-11-12T15:10:00Z");
  test("keeps polling until expires_at", () => {
    expect(discordWait({ claimed: false }, expires, expires - 1)).toBe("waiting");
    expect(discordWait({ claimed: false }, expires, expires)).toBe("expired");
  });
  test("stops on claimed, even after expires_at", () => {
    expect(discordWait({ claimed: true }, expires, expires - 60_000)).toBe("done");
    expect(discordWait({ claimed: true }, expires, expires + 1)).toBe("done");
  });
  test("expires_at from the start reply", () => {
    expect(loginExpiry("2026-11-12T15:10:00Z", 0)).toBe(expires);
    expect(loginExpiry("", 1000)).toBe(1000 + 10 * 60_000);
    expect(loginExpiry("not a date", 1000)).toBe(1000 + 10 * 60_000);
  });
});
