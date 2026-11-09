/** The server's gamer tag rules (coordinator ValidGamerTag): trimmed, 3-24
 * characters of letters in any script, digits, spaces and _ - ., no double
 * spaces, at least one letter or digit. */

export const GAMER_TAG_MIN = 3;
export const GAMER_TAG_MAX = 24;

const ALLOWED = /^[\p{L}\p{Nd} _.\-]*$/u;
const ALNUM = /[\p{L}\p{Nd}]/u;

export interface GamerTagRule {
  key: "length" | "characters" | "spaces" | "letterOrDigit";
  ok: boolean;
}

/** Each rule and whether the name passes it, for the live hints. */
export function gamerTagRules(raw: string): GamerTagRule[] {
  const name = raw.trim();
  const length = [...name].length;
  return [
    { key: "length", ok: length >= GAMER_TAG_MIN && length <= GAMER_TAG_MAX },
    { key: "characters", ok: ALLOWED.test(name) },
    { key: "spaces", ok: !name.includes("  ") },
    { key: "letterOrDigit", ok: ALNUM.test(name) },
  ];
}

export function isValidGamerTag(raw: string): boolean {
  return gamerTagRules(raw).every((rule) => rule.ok);
}
