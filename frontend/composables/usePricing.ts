import { ref } from "vue";
import { CheckoutURL, PricingPlans, Quote } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type {
  PricingError,
  PricingOption,
  PricingPlan,
  PricingPlans as PricingPlansData,
  Quote as QuoteData,
} from "~/bindings/github.com/lagzap/lagzap/adapter/models";
import { formatLocale } from "~/utils/localeFormat";

// Plans for sale and their quotes. Every amount shown comes from the
// coordinator; the app only formats it (minor units / 10^digits) and splits
// a quoted total into months or players for display.

const CURRENCY_KEY = "lagzap.pricing.currency";
const QUOTE_TTL = 5 * 60 * 1000;

const pricing = ref<PricingPlansData | null>(null);
const plansLoading = ref(false);
const plansError = ref<PricingError | null>(null);
const currency = ref(readCurrency());

const quoteCache = new Map<string, { at: number; quote: QuoteData }>();

function readCurrency(): string {
  try {
    return localStorage.getItem(CURRENCY_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveCurrency(code: string) {
  try {
    if (code) localStorage.setItem(CURRENCY_KEY, code);
    else localStorage.removeItem(CURRENCY_KEY);
  } catch {
    // no storage: the choice lasts this run
  }
}

/** Loads the plans in the chosen currency; an unavailable currency falls
 * back to the server's first. */
async function loadPlans(code = currency.value): Promise<void> {
  plansLoading.value = true;
  try {
    let result = await PricingPlans(code);
    if (result.error?.message === "currency_unavailable" && code) {
      saveCurrency("");
      result = await PricingPlans("");
    }
    if (result.error || !result.pricing) {
      plansError.value = result.error ?? ({ code: "unreachable", message: "unreachable" } as PricingError);
      return;
    }
    plansError.value = null;
    pricing.value = result.pricing;
    currency.value = result.pricing.currency;
  } catch {
    plansError.value = { code: "unreachable", message: "unreachable" } as PricingError;
  } finally {
    plansLoading.value = false;
  }
}

/** Remembers the currency and reloads the plans in it. */
async function setCurrency(code: string) {
  saveCurrency(code);
  currency.value = code;
  await loadPlans(code);
}

function quoteKey(planId: number, period: number, code: string, options: Record<string, number>, upgrade: boolean) {
  const sorted = Object.keys(options)
    .sort()
    .map((k) => `${k}=${options[k]}`)
    .join("&");
  return `${planId}|${period}|${code}|${sorted}|${upgrade ? "up" : ""}`;
}

export type QuoteOutcome = { quote: QuoteData | null; error: PricingError | null };

/** A quote, from the 5-minute cache when it has it. upgrade asks for the
 * signed-in user's price from their current plan (the rest of it credited). */
async function quote(
  planId: number,
  period: number,
  code: string,
  options: Record<string, number>,
  upgrade = false,
): Promise<QuoteOutcome> {
  const key = quoteKey(planId, period, code, options, upgrade);
  const hit = quoteCache.get(key);
  if (hit && Date.now() - hit.at < QUOTE_TTL) return { quote: hit.quote, error: null };
  try {
    const result = await Quote({ plan_id: planId, period, currency: code, options, upgrade });
    if (result.error || !result.quote) {
      return { quote: null, error: result.error ?? ({ code: "unreachable", message: "unreachable" } as PricingError) };
    }
    quoteCache.set(key, { at: Date.now(), quote: result.quote });
    return { quote: result.quote, error: null };
  } catch {
    return { quote: null, error: { code: "unreachable", message: "unreachable" } as PricingError };
  }
}

/** Rials are shown as Toman (IRT): 1 Toman = 10 Rials. The server and the
 * checkout link keep IRR. */
const RIALS_PER_TOMAN = 10;

/** A currency's name as shown: IRR reads as Toman. */
export function currencyLabel(code: string): string {
  if (code !== "IRR") return code;
  return formatLocale.value === "fa" ? "تومان" : "IRT";
}

/** An amount in minor units, with the currency's symbol. */
export function formatMoney(minor: number, code: string, digits: number): string {
  const value = minor / 10 ** digits;
  const locale = formatLocale.value === "fa" ? "fa-IR" : "en-US";
  if (code === "IRR") {
    const toman = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(value / RIALS_PER_TOMAN));
    return `${toman} ${currencyLabel(code)}`;
  }
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${code}`;
  }
}

/** The nearest value an option allows. */
export function snapOption(option: PricingOption, value: number): number {
  if (option.type === "choices") {
    const values = (option.choices ?? []).map((c) => c.value);
    if (!values.length) return option.included;
    return values.reduce((best, v) => (Math.abs(v - value) < Math.abs(best - value) ? v : best), values[0]);
  }
  const min = option.min || option.included;
  const max = option.max || Math.max(min, value);
  const step = option.step || 1;
  const clamped = Math.min(max, Math.max(min, value));
  return Math.min(max, min + Math.round((clamped - min) / step) * step);
}

/** The first plan (API order) whose options can reach value, for "Purchase"
 * buttons that know which limit would unlock a feature. */
export function planFor(plans: PricingPlan[], option: string, value: number): PricingPlan | null {
  for (const plan of plans) {
    const opt = plan.options?.find((o) => o.option === option);
    const fixed = planLimit(plan, option);
    // A plan without the active apps limit has none: it reaches any value.
    if (!opt && option === "max_active_titles" && fixed === 0) return plan;
    const reach = opt ? Math.max(opt.included, opt.max || 0, ...(opt.choices ?? []).map((c) => c.value)) : fixed;
    if (reach >= value) return plan;
  }
  return null;
}

/** What a plan gives for a limit when no option sells it. */
export function planLimit(plan: PricingPlan, option: string): number {
  const fields: Record<string, number | undefined> = {
    seats: plan.seats,
    devices: plan.devices,
    max_hops: plan.max_hops,
    max_internets: plan.max_internets,
    routes: plan.routes,
    fair_traffic: plan.fair_traffic,
    max_active_titles: plan.max_active_titles,
  };
  return fields[option] ?? 0;
}

export async function checkoutURL(
  planId: number,
  period: number,
  code: string,
  changed: Record<string, number>,
  upgrade: boolean,
) {
  return CheckoutURL(planId, period, code, changed, upgrade);
}

export function usePricing() {
  return { pricing, plansLoading, plansError, currency, loadPlans, setCurrency, quote };
}
