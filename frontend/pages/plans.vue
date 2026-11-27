<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useLocale } from "vuetify";
import { Browser } from "@wailsio/runtime";
import Container from "~/components/layout/Container.vue";
import type {
  PricingOption,
  PricingPeriod,
  PricingPlan,
  Quote as QuoteData,
} from "~/bindings/github.com/lagzap/lagzap/adapter/models";
import { checkoutURL, currencyLabel, formatMoney, planFor, planLimit, snapOption, usePricing } from "~/composables/usePricing";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { formatTeamDate, useTeam } from "~/composables/useTeam";
// Prices and plans read in the language's own digits, whatever the Latin
// numbers setting says.
import { nativeDigits as localDigits } from "~/utils/localeFormat";
import { useRouteLevel } from "~/composables/useRouteLevel";

/** Plans for sale: the team size (Solo, Duo, ...) and billing period picked
 * above, then a card per plan for sale (Basic, Advanced, ...) priced by the
 * coordinator for that size and period; Free, full width, below. Buy hands
 * off to the website's checkout. */
const { t } = useLocale();
const { levelName } = useRouteLevel();
const route = useRoute();
const { pricing, plansLoading, plansError, loadPlans, setCurrency, quote } = usePricing();
const planAccess = usePlanAccess();
const { team, active: teamActive } = useTeam();

const plans = computed(() => pricing.value?.plans ?? []);
const code = computed(() => pricing.value?.currency ?? "");
const digits = computed(() => pricing.value?.digits ?? 2);
const money = (minor: number) => formatMoney(minor, code.value, digits.value, true);

/** Internets and route paths come with the route level: Basic 1, Advanced 2,
 * Ultimate 3. Devices stay at 1 for now. Neither is picked here. */
const BY_LEVEL = new Set(["max_internets", "routes"]);
const FIXED: Record<string, number> = { devices: 1 };
/** Options that follow the route level or are fixed: shown, never chosen or sent. */
const NOT_CHOSEN = new Set([...BY_LEVEL, ...Object.keys(FIXED)]);
/** Fair use is private: the server sets it from the plan and internets, so
 * it is never shown or chosen here. */
const HIDDEN_OPTIONS = new Set(["fair_traffic"]);
/** The most popular route level gets the ribbon. */
const POPULAR_LEVEL = 2;

/* ----- Team size: picked above the cards, for every plan ----- */
const seatsOption = (plan: PricingPlan) => plan.options?.find((o) => o.option === "seats") ?? null;

/** The player counts a plan sells: its seats option's values, or its own seats. */
function seatValuesOf(plan: PricingPlan): number[] {
  const o = seatsOption(plan);
  if (!o) return [plan.seats || 1];
  if (o.type === "choices") return (o.choices ?? []).map((c) => c.value);
  const out: number[] = [];
  for (let v = minOf(o); v <= maxOf(o); v += stepOf(o)) out.push(v);
  return out;
}

/** Every team size some plan sells, smallest first. */
const teamSizes = computed(() => [...new Set(plans.value.flatMap(seatValuesOf))].sort((a, b) => a - b));
const seats = ref(1);
const sellsSeats = (plan: PricingPlan, n: number) => seatValuesOf(plan).includes(n);

const TEAM_NAMES: Record<number, string> = { 1: "solo", 2: "duo", 3: "trio", 4: "squad" };
function teamName(n: number): string {
  const name = TEAM_NAMES[n];
  return name ? t(`$vuetify.plans.names.${name}`) : t("$vuetify.plans.facts.seats", localDigits(n));
}

/* ----- Each plan's own options (active apps, ...) ----- */
/** Each route level's colour, as on the route level meter (never the
 * primary): Basic green, Advanced cyan, Ultimate violet. */
const LEVEL_COLORS: Record<number, string> = { 1: "success", 2: "info", 3: "#B388FF" };
const choices = ref<Record<number, Record<string, number>>>({});

const included = (plan: PricingPlan): Record<string, number> =>
  Object.fromEntries(
    (plan.options ?? []).filter((o) => o.option !== "seats" && !NOT_CHOSEN.has(o.option)).map((o) => [o.option, o.included]),
  );
const planChoices = (plan: PricingPlan) => choices.value[plan.id] ?? included(plan);

/** What a card sends: its options changed from the base, and the team size. */
function cardOptions(plan: PricingPlan): Record<string, number> {
  const out: Record<string, number> = {};
  const picked = planChoices(plan);
  for (const o of plan.options ?? []) {
    if (o.option === "seats") {
      const n = snapOption(o, seats.value);
      if (n !== o.included) out.seats = n;
      continue;
    }
    const v = picked[o.option];
    if (v !== undefined && v !== o.included) out[o.option] = v;
  }
  return out;
}

/** The plan's route level: as picked when it sells levels, else its own. */
function levelOf(plan: PricingPlan): number {
  const v = planChoices(plan).max_hops ?? planLimit(plan, "max_hops");
  return Math.min(3, Math.max(1, v || 1));
}

/** "need=max_internets:3" from a Purchase button: the limit that would
 * unlock what the user tried. */
function parseNeed(): { option: string; value: number } | null {
  const raw = String(route.query.need ?? "");
  const [option, value] = raw.split(":");
  const n = Number(value);
  if (!option || !Number.isFinite(n) || n <= 0) return null;
  if (BY_LEVEL.has(option)) return { option: "max_hops", value: Math.min(3, n) };
  return { option, value: n };
}

/** Starts at the user's own team size, or what a Purchase button asked for. */
function pickInitial() {
  const sizes = teamSizes.value;
  if (!sizes.length) return;
  const need = parseNeed();
  const mine = plans.value.find((p) => p.id === planAccess.access.value?.plan_id);
  let n = mine ? (seatsOption(mine)?.included ?? mine.seats) : sizes[0];
  if (need?.option === "seats") n = need.value;
  seats.value = sizes.find((s) => s >= n) ?? sizes[sizes.length - 1];
  if (need && need.option !== "seats") {
    const plan = planFor(plans.value, need.option, need.value);
    const opt = plan?.options?.find((o) => o.option === need.option);
    if (plan && opt && need.value > opt.included) {
      choices.value = { ...choices.value, [plan.id]: { ...planChoices(plan), [need.option]: snapOption(opt, need.value) } };
    }
  }
}

function resetOptions() {
  choices.value = {};
}

/** An option differs from where its plan starts (Reset shows). */
const differsFromDefaults = computed(() =>
  plans.value.some((plan) => {
    const base = included(plan);
    const picked = planChoices(plan);
    return Object.keys(base).some((k) => picked[k] !== base[k]);
  }),
);

/* ----- Quotes: one per card for the chosen period, plus the monthly one
   for the strike-through ----- */
const quotes = ref<Record<string, QuoteData>>({});
const quoting = ref(false);
const quoteFailed = ref(false);
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** The billing period picked beside the team size; monthly to start. */
const periodCount = ref(1);
/** Monthly, quarterly, half year and yearly always show; one no plan sells
 * is disabled. */
const STANDARD_COUNTS = [1, 3, 6, 12];
const interval = computed(() => plans.value[0]?.interval || "month");
const periodOf = (plan: PricingPlan, count: number) => plan.periods?.find((p) => p.count === count) ?? null;
const periodTabs = computed(() => {
  const sold = new Map<number, PricingPeriod>();
  for (const plan of plans.value) for (const p of plan.periods ?? []) if (!sold.has(p.count)) sold.set(p.count, p);
  const counts = interval.value === "month" ? [...new Set([...STANDARD_COUNTS, ...sold.keys()])] : [...sold.keys()];
  return counts.sort((a, b) => a - b).map((count) => ({ count, period: sold.get(count) ?? null }));
});

/** The plans shown: for sale at this team size and period. */
const shownPlans = computed(() =>
  plans.value.filter((plan) => sellsSeats(plan, seats.value) && periodOf(plan, periodCount.value)),
);

const quoteKey = (planId: number, count: number) => `${planId}|${count}`;

function scheduleQuotes() {
  clearTimeout(timer);
  if (!shownPlans.value.length || !code.value) return;
  quoting.value = true;
  timer = setTimeout(() => void runQuotes(), 300);
}

async function runQuotes() {
  const count = periodCount.value;
  const mine = ++generation;
  const currency = code.value;
  // Each card at the chosen period, and monthly too when the period is
  // discounted (its price is struck through).
  const jobs = shownPlans.value.flatMap((plan) => {
    const chosen = periodOf(plan, count);
    const counts = [count, ...(chosen && chosen.discount_percent > 0 && periodOf(plan, 1) && count !== 1 ? [1] : [])];
    return counts.map((c) => ({ plan, count: c }));
  });
  const ask = (job: { plan: PricingPlan; count: number }, upgrade: boolean) =>
    quote(job.plan.id, job.count, currency, cardOptions(job.plan), upgrade);
  const results = await Promise.all(jobs.map((job) => ask(job, upgradeFor(job.plan))));
  // Not above the current plan: priced as a plain purchase.
  const retry = results.map((r, i) => (r.error?.message === "not_an_upgrade" ? i : -1)).filter((i) => i >= 0);
  if (retry.length) {
    const again = await Promise.all(retry.map((i) => ask(jobs[i], false)));
    retry.forEach((i, k) => (results[i] = again[k]));
  }
  if (mine !== generation) return; // a newer choice is being quoted

  const failedAt = results.findIndex((r) => r.error);
  if (failedAt >= 0) {
    const failure = results[failedAt].error!;
    const plan = jobs[failedAt].plan;
    switch (failure.message) {
      case "plan_unavailable":
        await loadPlans();
        return;
      case "currency_unavailable": {
        const first = pricing.value?.currencies?.[0]?.code ?? "";
        await setCurrency(first === currency ? "" : first);
        return;
      }
      case "invalid_option": {
        const opt = plan.options?.find((o) => o.option === failure.option);
        if (opt && opt.option !== "seats") {
          const was = planChoices(plan)[opt.option] ?? opt.included;
          const snapped = snapOption(opt, was);
          choices.value = {
            ...choices.value,
            [plan.id]: { ...planChoices(plan), [opt.option]: snapped === was ? opt.included : snapped },
          };
          return;
        }
        break;
      }
      case "rate_limited":
        // already retried once: keep what is shown, no error
        quoting.value = false;
        return;
    }
    quoteFailed.value = true;
    quoting.value = false;
    return;
  }
  const next: Record<string, QuoteData> = {};
  jobs.forEach((job, i) => {
    const q = results[i].quote;
    if (q) next[quoteKey(job.plan.id, job.count)] = q;
  });
  quotes.value = next;
  quoteFailed.value = false;
  quoting.value = false;
}

onBeforeUnmount(() => clearTimeout(timer));

/* ----- Cards: one per plan ----- */
function periodTitle(count: number): string {
  if (interval.value === "month") {
    if ([1, 3, 6, 12].includes(count)) return t(`$vuetify.plans.period.${count}`);
    return t("$vuetify.plans.period.months", localDigits(count));
  }
  return t("$vuetify.plans.period.other", localDigits(count), interval.value);
}

function perLabel(): string {
  const key = `$vuetify.plans.per.${interval.value}`;
  const text = t(key);
  return text === key ? t("$vuetify.plans.per.other", interval.value) : text;
}

function billedText(count: number, total: string): string {
  if (interval.value === "month") {
    if (count === 1) return t("$vuetify.plans.billed.month");
    if (count === 12) return t("$vuetify.plans.billed.yearly", total);
    return t("$vuetify.plans.billed.months", total, localDigits(count));
  }
  if (count === 1) return t("$vuetify.plans.billed.other", total, localDigits(1), interval.value);
  return t("$vuetify.plans.billed.other", total, localDigits(count), interval.value);
}

const FACTS: { key: string; icon: string }[] = [
  { key: "seats", icon: "mdi-account-multiple-outline" },
  { key: "devices", icon: "mdi-devices" },
  { key: "max_active_titles", icon: "mdi-gamepad-variant-outline" },
  { key: "max_internets", icon: "mdi-call-split" },
  { key: "routes", icon: "mdi-routes" },
];
const CHECK_FACTS = ["disconnect", "bypass", "splitTunnel", "bandwidthControl", "packetLoss", "geofence"].map((key) => ({
  key,
  icon: "mdi-check-circle-outline",
  value: 1,
  option: null as PricingOption | null,
}));

/** Ultimate only, not out yet: listed with a Coming soon chip. */
const SOON_FACTS = [{ key: "easyLobby", icon: "mdi-account-group-outline", value: 1, option: null as PricingOption | null }];
const SOON = new Set(SOON_FACTS.map((f) => f.key));

function optionValue(plan: PricingPlan, q: QuoteData | undefined, key: string): number {
  if (key in FIXED) return FIXED[key];
  if (BY_LEVEL.has(key)) return levelOf(plan);
  if (key === "seats") return seats.value;
  const chosen = planChoices(plan)[key];
  if (chosen !== undefined) return chosen;
  const fromQuote = q?.options?.[key];
  if (fromQuote !== undefined && fromQuote !== null) return fromQuote;
  return planLimit(plan, key);
}

/** A card is the user's plan: the same plan, nothing changed. */
const isCurrentCard = (plan: PricingPlan) =>
  !expired.value && currentPlanId.value === plan.id && !Object.keys(cardOptions(plan)).length;

const cards = computed(() => {
  const count = periodCount.value;
  const many = shownPlans.value.length > 1;
  return shownPlans.value.map((plan) => {
    const chosen = periodOf(plan, count)!;
    const q = quotes.value[quoteKey(plan.id, count)];
    const monthly = quotes.value[quoteKey(plan.id, 1)];
    const months = count * (plan.count || 1);
    const perInterval = q ? q.amount / months : 0;
    const level = levelOf(plan);
    const mine = isCurrentCard(plan);
    return {
      plan,
      level,
      quote: q,
      title: planName(plan.name),
      popular: many && level === POPULAR_LEVEL,
      current: mine,
      credit: q?.upgrade && q.credit > 0 ? t("$vuetify.plans.credit", money(q.credit)) : "",
      buyLabel: q?.upgrade ? t("$vuetify.plans.upgrade") : mine ? t("$vuetify.plans.renew") : t("$vuetify.plans.buy"),
      price: q ? money(perInterval) : "",
      billed: q && count > 1 ? billedText(count, money(q.amount)) : q ? billedText(1, "") : "",
      perPlayer: q && seats.value > 1 ? t("$vuetify.plans.perPlayer", money(perInterval / seats.value)) : "",
      strike: q && chosen.discount_percent > 0 && monthly ? money(monthly.amount / (plan.count || 1)) : "",
      facts: [
        ...FACTS.map((f) => ({ ...f, value: optionValue(plan, q, f.key), option: editable(plan, f.key) })),
        ...shownOptions(plan)
          .filter((o) => !FACTS.some((f) => f.key === o.option))
          .map((o) => ({
            key: o.option,
            icon: "mdi-tune-variant",
            value: optionValue(plan, q, o.option),
            option: o as PricingOption | null,
          })),
      ]
        .filter((f) => f.value > 0 || f.option || f.key === "max_active_titles")
        .concat(CHECK_FACTS)
        .concat(level === 3 ? SOON_FACTS : []),
    };
  });
});

const detailsOpen = ref(false);

function lineLabel(line: { type?: string; option?: string; label?: string; value?: number }): string {
  if (line.type === "base") return t("$vuetify.plans.lines.base");
  if (line.type === "discount") return t("$vuetify.plans.lines.discount");
  if (line.type === "credit") return t("$vuetify.plans.lines.credit");
  if (line.option) {
    const name = optionName(line.option);
    return line.value ? `${name} · ${optionValueText(line.option, line.value)}` : name;
  }
  return line.label || line.type || "";
}

/* ----- Options on a card ----- */
function optionName(option: string): string {
  const key = `$vuetify.plans.options.${option}`;
  const text = t(key);
  return text === key ? option : text;
}

/** How a value reads: the route level by name (Basic, Advanced, Ultimate),
 * anything else as a number. */
function optionValueText(option: string, value: number): string {
  if (option === "max_hops") return levelName(Math.min(3, Math.max(1, value))) || localDigits(value);
  return localDigits(value);
}

/** Without a plan: what a plan would add. */
const noPlan = computed(() => ["none", "expired"].includes(planAccess.status.value));
/** What Free has (every plan has them too) and what it needs a plan for. */
const FREE_INCLUDED = ["bypass", "splitTunnel", "bandwidthControl"];
const FREE_MISSING = ["routing", "disconnect", "packetLoss", "geofence", "levels", "multiInternet"];
/** Checkmark facts every plan has. */
const CHECKS = new Set(["disconnect", "bypass", "splitTunnel", "bandwidthControl", "packetLoss", "geofence"]);
/** Checkmark facts with an explaining tooltip. */
const FACT_INFO: Record<string, string> = {
  routes: "$vuetify.plans.routesInfo",
  packetLoss: "$vuetify.plans.packetLossInfo",
  geofence: "$vuetify.plans.geofenceInfo",
};

function stepOf(o: PricingOption) {
  return o.step || 1;
}
function minOf(o: PricingOption) {
  return o.min || o.included;
}
function maxOf(o: PricingOption) {
  return o.max || o.included;
}
function current(plan: PricingPlan, o: PricingOption) {
  return planChoices(plan)[o.option] ?? o.included;
}
function setOption(plan: PricingPlan, o: PricingOption, value: number) {
  choices.value = { ...choices.value, [plan.id]: { ...planChoices(plan), [o.option]: snapOption(o, value) } };
}

/** The price of the option's next step, as the server lists it (a hint). */
function nextStepHint(plan: PricingPlan, o: PricingOption): string {
  const v = current(plan, o);
  if (v + stepOf(o) > maxOf(o)) return "";
  let amount = 0;
  if (o.type === "unit") amount = o.unit_amount;
  else if (o.type === "tiers") {
    const next = v + stepOf(o);
    amount = (o.tiers ?? []).find((tier) => !tier.up_to || next <= tier.up_to)?.amount ?? 0;
  }
  return amount > 0 ? t("$vuetify.plans.hint", money(amount), perLabel()) : "";
}

/** The options a buyer changes on the card (the team size is picked above). */
const shownOptions = (plan: PricingPlan) =>
  (plan.options ?? []).filter((o) => !HIDDEN_OPTIONS.has(o.option) && o.option !== "seats" && !NOT_CHOSEN.has(o.option));
/** The option behind a fact, when the buyer can change it on the card. */
const editable = (plan: PricingPlan, key: string): PricingOption | null =>
  shownOptions(plan).find((o) => o.option === key) ?? null;

/** Plan names the app knows read in the UI language (Solo, Duo, ...). */
function planName(name: string): string {
  const key = `$vuetify.plans.names.${name.trim().toLowerCase()}`;
  const text = t(key);
  return text === key ? name : text;
}

/** A fact's text; "1 player", not "1 players". */
function factText(key: string, value: number): string {
  if (CHECKS.has(key)) return t(`$vuetify.plans.facts.${key}`);
  if (!FACTS.some((f) => f.key === key)) return `${optionName(key)}: ${optionValueText(key, value)}`;
  if (key === "max_active_titles" && value === 0) return t("$vuetify.plans.facts.max_active_titlesUnlimited");
  const one = `$vuetify.plans.facts.${key}One`;
  if (value === 1 && t(one) !== one) return t(one);
  return t(`$vuetify.plans.facts.${key}`, optionValueText(key, value));
}
const shownLines = (lines: { option?: string }[] | undefined) =>
  (lines ?? []).filter((l) => !l.option || !HIDDEN_OPTIONS.has(l.option)) as NonNullable<QuoteData["lines"]>;

/* ----- The user's plan ----- */
const access = computed(() => planAccess.access.value);
const currentPlanId = computed(() => access.value?.plan_id || 0);
const expired = computed(() => {
  if (access.value?.status === "expired") return true;
  const ends = access.value?.expires_at ? new Date(access.value.expires_at) : null;
  return !!ends && !Number.isNaN(ends.getTime()) && ends.getTime() < Date.now();
});
/** The user's own plan is running: anything above it is an upgrade, paid as
 * the difference. Renewing the same choice (the current card) is not. */
const upgradeMode = computed(
  () => !!access.value?.active && access.value.source !== "team" && currentPlanId.value > 0 && !expired.value,
);
const upgradeFor = (plan: PricingPlan) => upgradeMode.value && !isCurrentCard(plan);

const planLine = computed(() => {
  const a = access.value;
  if (!a?.name) return "";
  let text = t("$vuetify.plans.yourPlan", a.name);
  if (a.expires_at) {
    text += `, ${t(expired.value ? "$vuetify.plans.endedOn" : "$vuetify.plans.endsOn", formatTeamDate(a.expires_at, true))}`;
  }
  return text;
});
const teamLine = computed(() =>
  access.value?.source === "team" && access.value.team_owner ? t("$vuetify.plans.teamVia", access.value.team_owner) : "",
);
const teamMember = computed(() => team.value?.role === "member" && teamActive.value);

/* ----- Buy: the website takes payment ----- */
const checkout = ref<{ url: string; planId: number; expiresAt: string } | null>(null);

async function buy(plan: PricingPlan) {
  const count = periodCount.value;
  if (!periodOf(plan, count)) return;
  const upgrade = !!quotes.value[quoteKey(plan.id, count)]?.upgrade;
  const url = await checkoutURL(plan.id, count, code.value, cardOptions(plan), upgrade);
  checkout.value = { url, planId: currentPlanId.value, expiresAt: access.value?.expires_at ?? "" };
  void Browser.OpenURL(url);
}

function openAgain() {
  if (checkout.value) void Browser.OpenURL(checkout.value.url);
}

// The banner goes once the account update brings a new plan or a later end.
watch(
  () => [access.value?.plan_id, access.value?.expires_at] as const,
  ([planId, expiresAt]) => {
    const pending = checkout.value;
    if (!pending) return;
    const later = !!expiresAt && (!pending.expiresAt || new Date(expiresAt).getTime() > new Date(pending.expiresAt).getTime());
    if ((planId ?? 0) !== pending.planId || later) checkout.value = null;
  },
);

/* ----- Currency ----- */
const currencies = computed(() => pricing.value?.currencies ?? []);
const currencyModel = computed({
  get: () => code.value,
  set: (value: string) => void setCurrency(value),
});

// These run last, after everything they read is defined: on a return visit
// the plans are already loaded and the plans watch fires during setup.
let picked = false;
watch(
  plans,
  () => {
    if (!picked && plans.value.length) {
      picked = true;
      pickInitial();
    }
    // A team size no plan sells any more falls back to the nearest one.
    const sizes = teamSizes.value;
    if (sizes.length && !sizes.includes(seats.value)) seats.value = sizes.find((s) => s >= seats.value) ?? sizes[sizes.length - 1];
  },
  { immediate: true },
);
// A period no plan sells falls back to the first one sold.
watch(periodTabs, (tabs) => {
  if (!tabs.some((tab) => tab.count === periodCount.value && tab.period)) {
    const first = tabs.find((tab) => tab.period);
    if (first) periodCount.value = first.count;
  }
});
watch([shownPlans, seats, choices, code, periodCount, () => upgradeMode.value], scheduleQuotes, {
  deep: true,
  immediate: true,
});
if (!pricing.value) void loadPlans();
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">{{ t("$vuetify.plans.title") }}</v-app-bar-title>
      </template>

      <div class="plans-page">
        <!-- The user's plan; the currency in the corner -->
        <div class="d-flex align-start ga-3">
          <div class="d-flex flex-column ga-1 flex-grow-1 min-w-0">
            <div v-if="planLine" class="text-body-1 font-weight-medium">{{ planLine }}</div>
            <div v-else-if="access" class="text-body-2 text-medium-emphasis">{{ t("$vuetify.plans.noPlan") }}</div>
            <div v-if="teamLine" class="text-body-2">
              <v-icon icon="mdi-account-group-outline" size="16" class="me-1" />{{ teamLine }}
            </div>
          </div>
          <v-select
            v-if="currencies.length >= 2"
            v-model="currencyModel"
            :items="currencies.map((c) => ({ value: c.code, title: currencyLabel(c.code) }))"
            :label="t('$vuetify.plans.currency')"
            density="compact"
            variant="outlined"
            hide-details
            class="currency-select"
          />
        </div>

        <v-alert
          v-if="upgradeMode"
          type="info"
          variant="tonal"
          density="compact"
          icon="mdi-arrow-up-bold-circle-outline"
          :text="t('$vuetify.plans.upgradeNote')"
        />

        <v-alert
          v-if="teamMember"
          type="info"
          variant="tonal"
          density="compact"
          icon="mdi-account-group-outline"
          :text="t('$vuetify.plans.teamMemberNote')"
        />

        <v-banner v-if="checkout" lines="one" rounded="lg" class="plans-banner">
          <template #prepend>
            <v-avatar variant="tonal" icon="mdi-open-in-new" size="36" />
          </template>
          <v-banner-text>{{ t("$vuetify.plans.checkoutBanner") }}</v-banner-text>
          <template #actions>
            <v-btn variant="text" color="on-surface" @click="openAgain">{{ t("$vuetify.plans.openAgain") }}</v-btn>
          </template>
        </v-banner>

        <!-- Loading or failed -->
        <template v-if="!pricing">
          <v-alert v-if="plansError && !plansLoading" type="error" variant="tonal" :text="t('$vuetify.plans.loadFailed')">
            <template #append>
              <v-btn variant="text" @click="loadPlans()">{{ t("$vuetify.plans.retry") }}</v-btn>
            </template>
          </v-alert>
          <v-skeleton-loader v-else type="heading, card@3" class="bg-transparent" />
        </template>
        <div v-else-if="!plans.length" class="text-body-1 text-medium-emphasis">{{ t("$vuetify.plans.empty") }}</div>

        <template v-else>
          <!-- Team size, then the billing period at the far end -->
          <div class="plan-bar">
            <div class="lz-tabs" role="radiogroup" :aria-label="t('$vuetify.plans.title')">
              <button
                v-for="n in teamSizes"
                :key="n"
                type="button"
                role="radio"
                class="lz-tab"
                :class="{ 'lz-tab--active': seats === n }"
                :aria-checked="seats === n"
                @click="seats = n"
              >
                {{ teamName(n) }}
              </button>
            </div>
            <v-btn
              v-if="differsFromDefaults"
              variant="text"
              size="small"
              prepend-icon="mdi-restore"
              class="align-self-center"
              @click="resetOptions"
            >
              {{ t("$vuetify.plans.reset") }}
            </v-btn>
            <v-spacer />
            <div class="lz-tabs lz-tabs--joined" role="radiogroup">
              <button
                v-for="tab in periodTabs"
                :key="tab.count"
                type="button"
                role="radio"
                class="lz-tab"
                :class="{ 'lz-tab--active': periodCount === tab.count }"
                :aria-checked="periodCount === tab.count"
                :disabled="!tab.period"
                @click="periodCount = tab.count"
              >
                {{ periodTitle(tab.count) }}
                <span v-if="tab.period && tab.period.discount_percent > 0" class="period-off lz-num">−{{ localDigits(tab.period.discount_percent) }}{{ localDigits("%") }}</span>
              </button>
            </div>
          </div>

          <v-alert v-if="quoteFailed && !quoting" type="warning" variant="tonal" density="compact" :text="t('$vuetify.plans.quoteFailed')">
            <template #append>
              <v-btn variant="text" size="small" @click="scheduleQuotes">{{ t("$vuetify.plans.retry") }}</v-btn>
            </template>
          </v-alert>

          <!-- A card per plan for sale -->
          <div class="level-cards">
            <section
              v-for="col in cards"
              :key="col.plan.id"
              class="lz-panel level-card"
              :class="{ 'level-card--popular': col.popular, 'level-card--current': col.current }"
            >
              <div v-if="col.popular && !col.current" class="level-card__ribbon">{{ t("$vuetify.plans.popular") }}</div>

              <div class="d-flex align-center flex-wrap ga-2">
                <!-- The level's own colour (Basic green, Advanced cyan, Ultimate
                     violet), as on the route level meter; never the primary. -->
                <v-icon icon="mdi-rocket-launch-outline" size="20" :color="LEVEL_COLORS[col.level]" />
                <span class="text-h6 font-weight-bold">{{ col.title }}</span>
                <v-chip v-if="col.current" size="x-small" color="amber" variant="tonal" prepend-icon="mdi-check">
                  {{ t("$vuetify.plans.currentPlan") }}
                </v-chip>
              </div>
              <div class="level-card__about">
                <div class="level-card__for">{{ t("$vuetify.plans.bestFor") }}</div>
                <div class="text-body-2 text-medium-emphasis">{{ t(`$vuetify.plans.levelInfo.short${col.level}`) }}</div>
              </div>

              <v-skeleton-loader v-if="quoting || !col.quote" type="heading, text" class="bg-transparent price-skeleton" />
              <div v-else class="d-flex flex-column">
                <span v-if="col.strike" class="text-body-2 text-medium-emphasis text-decoration-line-through">
                  {{ col.strike }} {{ perLabel() }}
                </span>
                <div class="d-flex align-baseline flex-wrap ga-1">
                  <span class="text-h4 font-weight-bold">{{ col.price }}</span>
                  <span class="text-body-2 text-medium-emphasis">{{ perLabel() }}</span>
                </div>
                <span class="text-caption text-medium-emphasis">{{ col.billed }}</span>
                <span v-if="col.perPlayer" class="text-caption">{{ col.perPlayer }}</span>
                <span v-if="col.credit" class="text-caption text-success">{{ col.credit }}</span>
                <button type="button" class="price-details-toggle text-caption" @click="detailsOpen = !detailsOpen">
                  {{ t("$vuetify.plans.priceDetails") }}
                  <v-icon :icon="detailsOpen ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="14" />
                </button>
                <v-expand-transition>
                  <div v-if="detailsOpen" class="price-lines mt-1">
                    <div v-for="(line, i) in shownLines(col.quote?.lines)" :key="i" class="price-lines__row">
                      <span>{{ lineLabel(line) }}</span>
                      <span>{{ money(line.amount) }}</span>
                    </div>
                    <v-divider class="my-1" />
                    <div class="price-lines__row font-weight-bold">
                      <span>{{ t("$vuetify.plans.total") }}</span>
                      <span>{{ money(col.quote?.amount ?? 0) }}</span>
                    </div>
                  </div>
                </v-expand-transition>
              </div>

              <v-btn
                block
                rounded="lg"
                height="44"
                class="flex-grow-0"
                color="success"
                :variant="col.popular || col.current ? 'flat' : 'outlined'"
                prepend-icon="mdi-cart-outline"
                :disabled="quoting || !col.quote"
                @click="buy(col.plan)"
              >
                {{ col.buyLabel }}
              </v-btn>

              <v-divider />

              <!-- What it includes; what can be changed has its control on the row -->
              <ul class="level-card__facts">
                <li v-for="fact in col.facts" :key="fact.key">
                  <v-icon :icon="fact.icon" size="16" :color="CHECKS.has(fact.key) ? 'success' : undefined" />
                  <span class="flex-grow-1 min-w-0">
                    {{ SOON.has(fact.key) ? t(`$vuetify.plans.facts.${fact.key}`) : factText(fact.key, fact.value) }}
                    <v-chip v-if="SOON.has(fact.key)" size="x-small" variant="tonal" class="ms-1">
                      {{ t("$vuetify.plans.soon") }}
                    </v-chip>
                    <v-tooltip v-if="FACT_INFO[fact.key]" :text="t(FACT_INFO[fact.key]!)" location="top" max-width="300">
                      <template #activator="{ props: tip }">
                        <v-icon v-bind="tip" icon="mdi-information-outline" size="14" class="text-medium-emphasis ms-1" />
                      </template>
                    </v-tooltip>
                  </span>
                  <template v-if="fact.option">
                    <v-btn-toggle
                      v-if="fact.option.type === 'choices'"
                      :model-value="current(col.plan, fact.option)"
                      mandatory
                      rounded="lg"
                      density="compact"
                      variant="outlined"
                      color="on-surface"
                      divided
                      class="fact-choices"
                      @update:model-value="(v: number) => setOption(col.plan, fact.option!, v)"
                    >
                      <v-btn
                        v-for="c in fact.option.choices"
                        :key="c.value"
                        :value="c.value"
                        size="x-small"
                      >
                        {{ optionValueText(fact.option.option, c.value) }}
                        <v-tooltip
                          activator="parent"
                          :text="t('$vuetify.plans.hint', money(c.amount), perLabel())"
                          :disabled="!(c.amount > 0)"
                        />
                      </v-btn>
                    </v-btn-toggle>
                    <div v-else class="stepper">
                      <v-btn
                        icon="mdi-minus"
                        size="x-small"
                        variant="tonal"
                        density="comfortable"
                        :disabled="current(col.plan, fact.option) - stepOf(fact.option) < minOf(fact.option)"
                        @click="setOption(col.plan, fact.option, current(col.plan, fact.option) - stepOf(fact.option))"
                      />
                      <v-tooltip
                        :text="nextStepHint(col.plan, fact.option)"
                        :disabled="!nextStepHint(col.plan, fact.option)"
                      >
                        <template #activator="{ props: tip }">
                          <v-btn
                            v-bind="tip"
                            icon="mdi-plus"
                            size="x-small"
                            variant="tonal"
                            density="comfortable"
                            :disabled="current(col.plan, fact.option) + stepOf(fact.option) > maxOf(fact.option)"
                            @click="setOption(col.plan, fact.option, current(col.plan, fact.option) + stepOf(fact.option))"
                          />
                        </template>
                      </v-tooltip>
                    </div>
                  </template>
                </li>
              </ul>
            </section>
          </div>

          <!-- Free, the full width under the paid cards -->
          <section class="lz-panel free-row" :class="{ 'free-row--current': noPlan }">
            <div class="free-row__head">
              <v-icon icon="mdi-account-outline" size="20" />
              <span class="text-subtitle-1 font-weight-medium">{{ t("$vuetify.plans.free.title") }}</span>
              <v-chip v-if="noPlan" size="x-small" color="amber" variant="tonal" prepend-icon="mdi-check">
                {{ t("$vuetify.plans.free.badge") }}
              </v-chip>
            </div>
            <ul class="free-row__items">
              <li v-for="item in FREE_INCLUDED" :key="item" class="free-row__has">
                <v-icon icon="mdi-check-circle-outline" size="16" color="success" />
                <span>{{ t(`$vuetify.plans.facts.${item}`) }}</span>
              </li>
              <li v-for="item in FREE_MISSING" :key="item">
                <v-icon icon="mdi-close-circle-outline" size="16" />
                <span>{{ t(`$vuetify.plans.free.items.${item}`) }}</span>
              </li>
            </ul>
          </section>

          <!-- Static text -->
          <div class="d-flex flex-column ga-1 text-body-2 text-medium-emphasis">
            <div><v-icon icon="mdi-check-circle-outline" size="16" color="success" class="me-1" />{{ t("$vuetify.plans.cancelAnytime") }}</div>
            <div>
              <v-icon icon="mdi-star-four-points-outline" size="16" class="me-1" />
              <span class="font-weight-medium">{{ t("$vuetify.plans.allFeatures") }}:</span>
              {{ t("$vuetify.plans.featuresPlaceholder") }}
            </div>
          </div>
        </template>
      </div>
    </Container>
  </div>
</template>

<style scoped>
.plans-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  max-width: 1200px;
}

.currency-select {
  flex: 0 0 120px;
  max-width: 120px;
}

.plan-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.level-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
  align-items: stretch;
}

/* The cards share their rows (a subgrid): name, about, price, Buy, the
   line and what it includes each start at the same height in every card, so
   the Buy buttons line up however the prices wrap. */
.level-card {
  position: relative;
  overflow: hidden;
  display: grid;
  grid-row: span 6;
  grid-template-rows: subgrid;
  row-gap: 14px;
  align-content: start;
}

.level-card > * {
  align-self: start;
}

.level-card__about {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.level-card__for {
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  /* The one primary the user kept on this page. */
  color: rgb(var(--v-theme-primary));
}

/* Never the primary: the popular column a stronger neutral border, the
   user's own a solid one and a light wash. */
.level-card--popular {
  border: 2px solid rgba(var(--v-theme-on-surface), 0.32);
}

.level-card--current {
  border: 2px solid rgba(var(--v-theme-on-surface), 0.6);
  background: rgba(var(--v-theme-on-surface), 0.04);
}

/* A fixed-width band whose middle sits on the corner's diagonal, so any
   label length stays centred across it. */
.level-card__ribbon {
  position: absolute;
  top: 24px;
  right: -36px;
  width: 140px;
  transform: rotate(45deg);
  padding: 3px 0;
  text-align: center;
  white-space: nowrap;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  /* Neutral, never the primary: light band, dark words (and the reverse in
     the light theme). */
  background: rgb(var(--v-theme-on-surface));
  color: rgb(var(--v-theme-surface));
}

.v-locale--is-rtl .level-card__ribbon {
  right: auto;
  left: -36px;
  transform: rotate(-45deg);
}

.level-card__facts {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 0.875rem;
}

.level-card__facts li {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}

.period-off {
  margin-inline-start: 6px;
  font-size: 0.7rem;
  font-weight: 600;
  color: rgb(var(--v-theme-success));
}

/* Free: one full-width row; what a plan adds, side by side. */
.free-row {
  border-style: dashed;
}

.free-row--current {
  border: 2px solid rgba(var(--v-theme-on-surface), 0.6);
  border-style: solid;
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.free-row__head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.free-row__items {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
  font-size: 0.85rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.free-row__items li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.free-row__has {
  color: rgba(var(--v-theme-on-surface), 0.87);
}

.lz-tab:disabled {
  cursor: default;
  opacity: 0.38;
}

.level-tip {
  font-size: 0.8rem;
  line-height: 1.4;
}

.price-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.85rem;
}

.price-lines__row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.option-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.fact-choices {
  height: 26px !important;
  flex-shrink: 0;
}

.price-details-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  align-self: flex-start;
  margin-top: 4px;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
}

.price-skeleton {
  min-height: 92px;
}

.stepper__value {
  min-width: 2ch;
  text-align: center;
}

.choice-btn {
  min-height: 48px;
}
</style>
