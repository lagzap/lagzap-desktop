import { ref } from "vue";

/** Language numbers and units are written for. app.vue keeps it in step with
 * the Vuetify locale; plain functions read it, so templates that call them
 * re-render when the language changes. */
export const formatLocale = ref("en");

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

const UNITS: Record<string, { ms: string; bytes: string[]; perSecond: string }> = {
  en: { ms: "ms", bytes: ["B", "KB", "MB", "GB", "TB"], perSecond: "/s" },
  fa: { ms: "م.ث", bytes: ["ب", "ک.ب", "م.ب", "گ.ب", "ت.ب"], perSecond: "/ث" },
};

function units() {
  return UNITS[formatLocale.value] ?? UNITS.en;
}

function farsi() {
  return formatLocale.value === "fa";
}

/** Writes the digits, decimal sign and percent sign of text in the UI
 * language (Persian digits in fa). Leave IP addresses and ports alone. */
export function localDigits(text: string | number | null | undefined): string {
  const s = text == null ? "" : String(text);
  if (!farsi()) return s;
  return s
    .replace(/(\d)\.(?=\d)/g, "$1٫")
    .replace(/\d/g, (d) => FA_DIGITS[+d])
    .replace(/%/g, "٪");
}

/** "ms" or "م.ث". */
export function msUnit(): string {
  return units().ms;
}

/** A ping: "104ms" / "۱۰۴ م.ث"; empty when there is none. */
export function formatMs(value: number | null | undefined, empty = "—", decimals = 0): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return empty;
  const n = localDigits(decimals > 0 ? value.toFixed(decimals) : Math.round(value));
  return farsi() ? `${n} ${msUnit()}` : `${n}${msUnit()}`;
}

/** "MB/s" / "م.ب/ث" for 1024^power bytes per second. */
export function speedUnit(power: number): string {
  const u = units();
  return `${u.bytes[Math.min(power, u.bytes.length - 1)]}${u.perSecond}`;
}

/** Time of day in the UI language's digits. */
export function formatTimeOfDay(at: Date): string {
  return farsi() ? at.toLocaleTimeString("fa-IR") : at.toLocaleTimeString();
}

function scaled(bytes: number, perSecond: boolean): string {
  const u = units();
  const suffix = perSecond ? u.perSecond : "";
  if (!(bytes > 0)) return `${localDigits(0)} ${u.bytes[0]}${suffix}`;
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), u.bytes.length - 1);
  return `${localDigits((bytes / Math.pow(1024, i)).toFixed(2))} ${u.bytes[i]}${suffix}`;
}

/** "1.17 MB/s" / "۱٫۱۷ م.ب/ث". */
export function formatSpeed(bytesPerSecond: number): string {
  return scaled(bytesPerSecond, true);
}

/** "4.75 MB" / "۴٫۷۵ م.ب". */
export function formatSize(bytes: number): string {
  return scaled(bytes, false);
}

/** The app's font stack for ECharts, which draws on a canvas and would
 * otherwise use the system font. */
export function chartFontFamily(): string {
  if (typeof document !== "undefined") {
    const family = getComputedStyle(document.body).fontFamily;
    if (family) return family;
  }
  return '"Vazirmatn", "Roboto", sans-serif';
}

const regionNames = new Map<string, Intl.DisplayNames>();

function displayRegion(lang: string, iso2: string): string {
  try {
    let names = regionNames.get(lang);
    if (!names) {
      names = new Intl.DisplayNames([lang], { type: "region" });
      regionNames.set(lang, names);
    }
    return names.of(iso2.toUpperCase()) ?? "";
  } catch {
    return "";
  }
}

/** A country's name in the UI language ("آلمان" / "Germany"), else its code. */
export function countryName(iso2: string | null | undefined): string {
  if (!iso2) return "";
  return displayRegion(formatLocale.value, iso2) || displayRegion("en", iso2) || iso2;
}

/** A country's English name, for search that accepts either language. */
export function countryNameEn(iso2: string | null | undefined): string {
  return iso2 ? displayRegion("en", iso2) || iso2 : "";
}
