/**
 * Normalize ticket timestamps for display.
 *
 * The tickets API mixes formats: some messages include a trailing Z, others are
 * naive "YYYY-MM-DD HH:mm:ss". Both usually carry the same wall-clock value, but
 * JS treats "…Z" as UTC (+3:30 in Tehran) and naive strings as local — so the
 * same instant renders differently.
 *
 * Rule: use the date/time numbers as local wall-clock for naive and Z values.
 * Honor explicit ±HH:MM offsets when present.
 */
export function parseTicketTimestamp(value?: string | null): Date | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i,
  );

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6] || 0);
    const tz = match[7];

    const offsetMatch = tz?.match(/^([+-])(\d{2}):?(\d{2})$/);
    if (offsetMatch) {
      const sign = offsetMatch[1] === "-" ? -1 : 1;
      const offMin =
        sign * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]));
      const utcMs =
        Date.UTC(year, month - 1, day, hour, minute, second) - offMin * 60_000;
      return new Date(utcMs);
    }

    // Naive or Z: show the wall-clock in the user's local timezone.
    return new Date(year, month - 1, day, hour, minute, second);
  }

  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isFinite(n)) {
      return null;
    }
    return new Date(n < 1e12 ? n * 1000 : n);
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

export function formatTicketTimestamp(
  value?: string | null,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = parseTicketTimestamp(value);
  if (!date) {
    return value?.trim() || "";
  }
  return date.toLocaleString(undefined, options);
}

export function formatTicketTimeShort(value?: string | null): string {
  const date = parseTicketTimestamp(value);
  if (!date) {
    return value?.trim() || "";
  }
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Clock time only, e.g. "7:18 PM". */
export function formatTicketClockTime(value?: string | null): string {
  const date = parseTicketTimestamp(value);
  if (!date) {
    return "";
  }
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Local calendar day key YYYY-MM-DD for grouping. */
export function ticketDayKey(value?: string | null): string | null {
  const date = parseTicketTimestamp(value);
  if (!date) {
    return null;
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type TicketDayLabelKind = "today" | "yesterday" | "date";

export function ticketDayLabelKind(
  value?: string | null,
  now = new Date(),
): TicketDayLabelKind | null {
  const date = parseTicketTimestamp(value);
  if (!date) {
    return null;
  }
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfMsg = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfMsg.getTime()) / 86_400_000,
  );
  if (diffDays === 0) {
    return "today";
  }
  if (diffDays === 1) {
    return "yesterday";
  }
  return "date";
}

/** Absolute date label when not today/yesterday, e.g. "July 31, 2026". */
export function formatTicketDayLabel(value?: string | null): string {
  const date = parseTicketTimestamp(value);
  if (!date) {
    return "";
  }
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
