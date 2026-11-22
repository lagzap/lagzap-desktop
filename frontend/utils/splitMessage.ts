/** A ticket message holds up to 3,000 characters; a longer one goes out as up
 * to 5 messages (15,000 characters in all). Same rules as the website. */
export const MESSAGE_MAX = 3000;
export const MESSAGE_PARTS_MAX = 5;
export const MESSAGE_TOTAL_MAX = MESSAGE_MAX * MESSAGE_PARTS_MAX;

/** Splits text into parts of at most `max` characters, cutting at the last
 * line break, else the last space, in the second half of each part, so words
 * and lines stay whole; a part without either is cut at `max` (never inside a
 * surrogate pair). Returns null when it needs more than `parts` messages. */
export function splitMessage(
  text: string,
  max = MESSAGE_MAX,
  parts = MESSAGE_PARTS_MAX,
): string[] | null {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = window.lastIndexOf("\n");
    if (cut < max / 2) {
      cut = Math.max(window.lastIndexOf(" "), window.lastIndexOf("\t"));
    }
    if (cut < max / 2) {
      cut = max;
      const code = rest.charCodeAt(cut - 1);
      if (code >= 0xd800 && code <= 0xdbff) {
        cut -= 1;
      }
    }
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
    if (out.length >= parts) {
      return null;
    }
  }
  if (rest) {
    out.push(rest);
  }
  return out;
}

/** Whether text starts right-to-left (Persian, Arabic, Hebrew): its first
 * letter decides, as in Telegram, which then puts the time on its own line. */
export function startsRtl(text: string): boolean {
  const first = text.match(
    /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ֐-ࣿיִ-﷿ﹰ-﻿]/,
  );
  return !!first && /[֐-ࣿיִ-﷿ﹰ-﻿]/.test(first[0]);
}
