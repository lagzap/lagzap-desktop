import { localDigits } from "~/utils/localeFormat";

type Translate = (key: string, ...params: unknown[]) => string;

/** Time left until ends (Unix ms), as "42 min" or "1 h 20 min". */
export function untilText(ends: number, t: Translate, now = Date.now()) {
  const minutes = Math.max(1, Math.ceil((ends - now) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return t("$vuetify.bandwidthControl.minutes", localDigits(minutes));
  if (!rest) return t("$vuetify.bandwidthControl.hours", localDigits(hours));
  return t("$vuetify.bandwidthControl.hoursMinutes", localDigits(hours), localDigits(rest));
}
