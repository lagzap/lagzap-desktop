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

/** Plans for sale: a column per route level (Basic, Advanced, Ultimate) for
 * the team size and billing period picked above them, priced by the
 * coordinator; Free, full width, below. Buy hands off to the website's
 * checkout. */
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

/* ----- The choice: plan and options ----- */
const selectedId = ref<number | null>(null);
const choices = ref<Record<string, number>>({});
const selected = computed<PricingPlan | null>(() => plans.value.find((p) => p.id === selectedId.value) ?? null);

const included = (plan: PricingPlan) =>
  Object.fromEntries((plan.options ?? []).filter((o) => !NOT_CHOSEN.has(o.option)).map((o) => [o.option, o.included]));

/** The options changed from what the base price includes. */
const changed = computed(() => {
  const plan = selected.value;
  if (!plan) return {};
  const out: Record<string, number> = {};
  for (const o of plan.options ?? []) {
    if (NOT_CHOSEN.has(o.option)) continue;
    const v = choices.value[o.option];
    if (v !== undefined && v !== o.included) out[o.option] = v;
  }
  return out;
});

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

/** Internets and route paths come with the route level: Basic 1, Advanced 2,
 * Ultimate 3. Devices stay at 1 for now. Neither is picked here. */
const BY_LEVEL = new Set(["max_internets", "routes"]);
const FIXED: Record<string, number> = { devices: 1 };

/** Where a plan starts: what its price includes, at the Advanced route level
 * when it sells route levels. */
const DEFAULT_ROUTE_LEVEL = 2;
function defaults(plan: PricingPlan): Record<string, number> {
  const out = included(plan);
  const level = plan.options?.find((o) => o.option === "max_hops");
  if (level) out.max_hops = snapOption(level, DEFAULT_ROUTE_LEVEL);
  return out;
}

/** Switches plan. carry keeps what was picked (route level, internets, route
 * paths) where the new plan sells it; seats come from the plan. */
function selectPlan(plan: PricingPlan, need: { option: string; value: number } | null = null, carry = false) {
  const next = defaults(plan);
  if (carry) {
    for (const o of plan.options ?? []) {
      const before = choices.value[o.option];
      if (o.option !== "seats" && before !== undefined && !NOT_CHOSEN.has(o.option)) next[o.option] = snapOption(o, before);
    }
  }
  const opt = need && plan.options?.find((o) => o.option === need.option);
  if (need && opt && need.value > opt.included) next[need.option] = snapOption(opt, need.value);
  selectedId.value = plan.id;
  choices.value = next;
}

function pickInitial() {
  const list = plans.value;
  if (!list.length) return;
  const need = parseNeed();
  const wanted = Number(route.query.plan) || 0;
  const plan =
    list.find((p) => p.id === wanted) ??
    (need ? planFor(list, need.option, need.value) : null) ??
    list.find((p) => p.id === planAccess.access.value?.plan_id) ??
    list[0];
  selectPlan(plan, need);
}

function resetOptions() {
  if (selected.value) choices.value = defaults(selected.value);
}

/** Something differs from where the plan starts (Reset shows). */
const differsFromDefaults = computed(() => {
  const plan = selected.value;
  if (!plan) return false;
  const base = defaults(plan);
  return Object.keys(base).some((k) => choices.value[k] !== base[k]);
});

/* ----- Players: the count picks the plan (Solo to Squad, then Clan) ----- */
const seatsOption = (plan: PricingPlan) => plan.options?.find((o) => o.option === "seats") ?? null;
const playerRange = computed(() => {
  let min = Infinity;
  let max = 0;
  for (const p of plans.value) {
    const o = seatsOption(p);
    min = Math.min(min, o ? o.min || o.included : p.seats);
    max = Math.max(max, o ? o.max || o.included : p.seats);
  }
  return { min: Number.isFinite(min) ? min : 1, max: max || 1 };
});
const playerCount = computed(() => choices.value.seats ?? selected.value?.seats ?? 1);

function setPlayers(count: number) {
  const n = Math.min(playerRange.value.max, Math.max(playerRange.value.min, count));
  const fixed = plans.value.find((p) => !seatsOption(p) && p.seats === n);
  const ranged = plans.value.find((p) => {
    const o = seatsOption(p);
    return o && n >= (o.min || o.included) && n <= (o.max || o.included);
  });
  const target = fixed ?? ranged;
  if (!target) return;
  if (target.id !== selectedId.value) selectPlan(target, null, true);
  const o = seatsOption(target);
  if (o) choices.value = { ...choices.value, seats: snapOption(o, n) };
}

/* ----- Quotes: one per route level for the chosen period, plus the monthly
   one for the strike-through ----- */
const quotes = ref<Record<string, QuoteData>>({});
const quoting = ref(false);
const quoteFailed = ref(false);
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

const periods = computed<PricingPeriod[]>(() => selected.value?.periods ?? []);
/** The billing period picked beside the team size; monthly to start. */
const periodCount = ref(1);
/** Monthly, quarterly, half year and yearly always show; one the plan does
 * not sell is disabled. */
const STANDARD_COUNTS = [1, 3, 6, 12];
const periodTabs = computed(() => {
  const sold = new Map(periods.value.map((p) => [p.count, p]));
  const counts = interval.value === "month" ? [...new Set([...STANDARD_COUNTS, ...sold.keys()])] : [...sold.keys()];
  return counts.sort((a, b) => a - b).map((count) => ({ count, period: sold.get(count) ?? null }));
});
const period = computed<PricingPeriod | null>(
  () => periods.value.find((p) => p.count === periodCount.value) ?? periods.value[0] ?? null,
);

/** The route levels sold side by side: Basic, Advanced, Ultimate. A plan
 * that sells none shows its own level alone. */
const levels = computed<number[]>(() => {
  if (levelOption.value) return levelValues(levelOption.value);
  const plan = selected.value;
  return [Math.min(3, Math.max(1, (plan ? planLimit(plan, "max_hops") : 0) || 1))];
});

/** What a column sends: the options changed from the base, at its level. */
function columnOptions(level: number): Record<string, number> {
  const out = { ...changed.value };
  delete out.max_hops;
  const o = levelOption.value;
  if (o && level !== o.included) out.max_hops = level;
  return out;
}

const quoteKey = (level: number, count: number) => `${level}|${count}`;

function scheduleQuotes() {
  clearTimeout(timer);
  if (!selected.value || !code.value || !period.value) return;
  quoting.value = true;
  timer = setTimeout(() => void runQuotes(), 300);
}

async function runQuotes() {
  const plan = selected.value;
  const chosen = period.value;
  if (!plan || !chosen) return;
  const mine = ++generation;
  const currency = code.value;
  // Each level at the chosen period, and monthly too when the period is
  // discounted (its price is struck through).
  const counts = [...new Set([chosen.count, ...(chosen.discount_percent > 0 && periods.value.some((p) => p.count === 1) ? [1] : [])])];
  const jobs = levels.value.flatMap((level) => counts.map((count) => ({ level, count })));
  const ask = (job: { level: number; count: number }, upgrade: boolean) =>
    quote(plan.id, job.count, currency, columnOptions(job.level), upgrade);
  let results = await Promise.all(jobs.map((job) => ask(job, upgradeFor(job.level))));
  // Not above the current plan: priced as a plain purchase.
  const retry = results.map((r, i) => (r.error?.message === "not_an_upgrade" ? i : -1)).filter((i) => i >= 0);
  if (retry.length) {
    const again = await Promise.all(retry.map((i) => ask(jobs[i], false)));
    retry.forEach((i, k) => (results[i] = again[k]));
  }
  if (mine !== generation) return; // a newer choice is being quoted

  const failure = results.find((r) => r.error)?.error;
  if (failure) {
    switch (failure.message) {
      case "plan_unavailable":
        selectedId.value = null;
        await loadPlans();
        return;
      case "currency_unavailable": {
        const first = pricing.value?.currencies?.[0]?.code ?? "";
        await setCurrency(first === currency ? "" : first);
        return;
      }
      case "invalid_option": {
        const opt = plan.options?.find((o) => o.option === failure.option);
        if (opt && opt.option !== "max_hops") {
          const current = choices.value[opt.option] ?? opt.included;
          const snapped = snapOption(opt, current);
          choices.value = { ...choices.value, [opt.option]: snapped === current ? opt.included : snapped };
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
    if (q) next[quoteKey(job.level, job.count)] = q;
  });
  quotes.value = next;
  quoteFailed.value = false;
  quoting.value = false;
}

onBeforeUnmount(() => clearTimeout(timer));

/* ----- Columns: one per route level ----- */
const interval = computed(() => selected.value?.interval || "month");
const intervalCount = computed(() => selected.value?.count || 1);

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

function optionValue(q: QuoteData | undefined, key: string, level: number): number {
  if (key in FIXED) return FIXED[key];
  if (BY_LEVEL.has(key)) return level;
  const plan = selected.value;
  const chosen = choices.value[key];
  if (chosen !== undefined) return chosen;
  const fromQuote = q?.options?.[key];
  if (fromQuote !== undefined && fromQuote !== null) return fromQuote;
  return plan ? planLimit(plan, key) : 0;
}

/** The level the user's own plan has, when it is this team size. */
const currentLevel = computed(() => {
  if (!isCurrent.value || expired.value) return 0;
  const v = planAccess.limits.value?.max_hops ?? 0;
  return v > 0 ? Math.min(3, v) : 0;
});
/** A column is the user's plan: same team size and level, nothing changed. */
const isCurrentColumn = (level: number) =>
  currentLevel.value === level && !Object.keys(columnOptions(level)).some((k) => k !== "max_hops");

const columns = computed(() => {
  const chosen = period.value;
  if (!chosen) return [];
  return levels.value.map((level) => {
    const q = quotes.value[quoteKey(level, chosen.count)];
    const monthly = quotes.value[quoteKey(level, 1)];
    const months = chosen.count * intervalCount.value;
    const perInterval = q ? q.amount / months : 0;
    const seats = optionValue(q, "seats", level) || selected.value?.seats || 1;
    const mine = isCurrentColumn(level);
    return {
      level,
      quote: q,
      title: levelName(level),
      tip: levelTip(level),
      popular: levels.value.length > 1 && level === DEFAULT_ROUTE_LEVEL,
      current: mine,
      upgrade: !!q?.upgrade,
      credit: q?.upgrade && q.credit > 0 ? t("$vuetify.plans.credit", money(q.credit)) : "",
      buyLabel: q?.upgrade
        ? t("$vuetify.plans.upgrade")
        : mine && !expired.value
          ? t("$vuetify.plans.renew")
          : t("$vuetify.plans.buy"),
      price: q ? money(perInterval) : "",
      billed: q && chosen.count > 1 ? billedText(chosen.count, money(q.amount)) : q ? billedText(1, "") : "",
      perPlayer: q && seats > 1 ? t("$vuetify.plans.perPlayer", money(perInterval / seats)) : "",
      strike: q && chosen.discount_percent > 0 && monthly ? money(monthly.amount / intervalCount.value) : "",
      facts: [
        ...FACTS.map((f) => ({ ...f, value: optionValue(q, f.key, level), option: editable(f.key) })),
        ...shownOptions.value
          .filter((o) => !FACTS.some((f) => f.key === o.option))
          .map((o) => ({
            key: o.option,
            icon: "mdi-tune-variant",
            value: optionValue(q, o.option, level),
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

/* ----- Customize ----- */
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

/** What a route level does and who it suits, in plain words. */
function levelTip(value: number) {
  const level = Math.min(3, Math.max(1, value));
  return {
    title: levelName(level),
    body: t(`$vuetify.plans.levelInfo.body${level}`),
    best: t(`$vuetify.plans.levelInfo.best${level}`),
  };
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

/** The route level is picked by name, like a choice. */
function levelValues(o: PricingOption): number[] {
  const out: number[] = [];
  for (let v = minOf(o); v <= maxOf(o); v += stepOf(o)) out.push(v);
  return out;
}

function stepOf(o: PricingOption) {
  return o.step || 1;
}
function minOf(o: PricingOption) {
  return o.min || o.included;
}
function maxOf(o: PricingOption) {
  return o.max || o.included;
}
function current(o: PricingOption) {
  return choices.value[o.option] ?? o.included;
}
function setOption(o: PricingOption, value: number) {
  choices.value = { ...choices.value, [o.option]: snapOption(o, value) };
}

/** The price of the option's next step, as the server lists it (a hint). */
function nextStepHint(o: PricingOption): string {
  const v = current(o);
  if (v + stepOf(o) > maxOf(o)) return "";
  let amount = 0;
  if (o.type === "unit") amount = o.unit_amount;
  else if (o.type === "tiers") {
    const next = v + stepOf(o);
    amount = (o.tiers ?? []).find((tier) => !tier.up_to || next <= tier.up_to)?.amount ?? 0;
  }
  return amount > 0 ? t("$vuetify.plans.hint", money(amount), perLabel()) : "";
}

/** The option behind a fact, when the buyer can change it. */
const editable = (key: string): PricingOption | null => shownOptions.value.find((o) => o.option === key) ?? null;

/** Fair use is private: the server sets it from the plan and internets, so
 * it is never shown or chosen here. */
const HIDDEN_OPTIONS = new Set(["fair_traffic"]);
/** The route level is picked next to the plan, not under Customize. */
const levelOption = computed(() => selected.value?.options?.find((o) => o.option === "max_hops") ?? null);
/** Options that follow the route level or are fixed: shown, never chosen or sent. */
const NOT_CHOSEN = new Set([...BY_LEVEL, ...Object.keys(FIXED)]);
const shownOptions = computed(() =>
  (selected.value?.options ?? []).filter(
    (o) => !HIDDEN_OPTIONS.has(o.option) && o.option !== "max_hops" && !NOT_CHOSEN.has(o.option),
  ),
);

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
const isCurrent = computed(() => !!selected.value && currentPlanId.value > 0 && selected.value.id === currentPlanId.value);
/** The user's own plan is running: anything above it is an upgrade, paid as
 * the difference. Renewing the same choice (the current column) is not. */
const upgradeMode = computed(
  () => !!access.value?.active && access.value.source !== "team" && currentPlanId.value > 0 && !expired.value,
);
const upgradeFor = (level: number) => upgradeMode.value && !isCurrentColumn(level);

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

async function buy(level: number) {
  const plan = selected.value;
  const chosen = period.value;
  if (!plan || !chosen) return;
  const upgrade = !!quotes.value[quoteKey(level, chosen.count)]?.upgrade;
  const url = await checkoutURL(plan.id, chosen.count, code.value, columnOptions(level), upgrade);
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
watch(
  plans,
  () => {
    if (!selected.value) pickInitial();
  },
  { immediate: true },
);
// A plan without the chosen period falls back to its first one.
watch(periods, (list) => {
  if (list.length && !list.some((p) => p.count === periodCount.value)) periodCount.value = list[0].count;
});
watch([selectedId, choices, code, periodCount, levels, () => upgradeMode.value, currentLevel], scheduleQuotes, {
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
            <div v-if="teamLine" class="text-body-2 text-primary">
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

        <v-banner v-if="checkout" color="primary" lines="one" rounded="lg" class="plans-banner">
          <template #prepend>
            <v-avatar color="primary" variant="tonal" icon="mdi-open-in-new" size="36" />
          </template>
          <v-banner-text>{{ t("$vuetify.plans.checkoutBanner") }}</v-banner-text>
          <template #actions>
            <v-btn variant="text" color="primary" @click="openAgain">{{ t("$vuetify.plans.openAgain") }}</v-btn>
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
                v-for="p in plans"
                :key="p.id"
                type="button"
                role="radio"
                class="lz-tab"
                :class="{ 'lz-tab--active': selectedId === p.id }"
                :aria-checked="selectedId === p.id"
                @click="selectPlan(p, null, true)"
              >
                {{ planName(p.name) }}
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
                :class="{ 'lz-tab--active': period?.count === tab.count }"
                :aria-checked="period?.count === tab.count"
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

          <!-- A column per route level -->
          <div class="level-cards">
            <section
              v-for="col in columns"
              :key="col.level"
              class="lz-panel level-card"
              :class="{ 'level-card--popular': col.popular, 'level-card--current': col.current }"
            >
              <div v-if="col.popular && !col.current" class="level-card__ribbon bg-primary">{{ t("$vuetify.plans.popular") }}</div>

              <div class="d-flex align-center flex-wrap ga-2">
                <v-icon icon="mdi-rocket-launch-outline" size="20" color="primary" />
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
                <span v-if="col.perPlayer" class="text-caption text-primary">{{ col.perPlayer }}</span>
                <span v-if="col.credit" class="text-caption text-success">{{ col.credit }}</span>
                <button type="button" class="price-details-toggle text-caption text-primary" @click="detailsOpen = !detailsOpen">
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
                :color="col.popular || col.current ? 'primary' : undefined"
                :variant="col.popular || col.current ? 'flat' : 'outlined'"
                prepend-icon="mdi-cart-outline"
                :disabled="quoting || !col.quote"
                @click="buy(col.level)"
              >
                {{ col.buyLabel }}
              </v-btn>

              <v-divider />

              <!-- What it includes; what can be changed has its control on the row -->
              <ul class="level-card__facts">
                <li v-for="fact in col.facts" :key="fact.key">
                  <v-icon :icon="fact.icon" size="16" :color="CHECKS.has(fact.key) ? 'success' : 'primary'" />
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
                  <div v-if="fact.key === 'seats'" class="stepper">
                    <v-btn
                      icon="mdi-minus"
                      size="x-small"
                      variant="tonal"
                      density="comfortable"
                      :disabled="playerCount <= playerRange.min"
                      @click="setPlayers(playerCount - 1)"
                    />
                    <v-btn
                      icon="mdi-plus"
                      size="x-small"
                      variant="tonal"
                      density="comfortable"
                      :disabled="playerCount >= playerRange.max"
                      @click="setPlayers(playerCount + 1)"
                    />
                  </div>
                  <template v-else-if="fact.option">
                    <v-btn-toggle
                      v-if="fact.option.type === 'choices'"
                      :model-value="current(fact.option)"
                      mandatory
                      rounded="lg"
                      density="compact"
                      variant="outlined"
                      color="primary"
                      divided
                      class="fact-choices"
                      @update:model-value="(v: number) => setOption(fact.option!, v)"
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
                        :disabled="current(fact.option) - stepOf(fact.option) < minOf(fact.option)"
                        @click="setOption(fact.option, current(fact.option) - stepOf(fact.option))"
                      />
                      <v-tooltip
                        :text="nextStepHint(fact.option)"
                        :disabled="!nextStepHint(fact.option)"
                      >
                        <template #activator="{ props: tip }">
                          <v-btn
                            v-bind="tip"
                            icon="mdi-plus"
                            size="x-small"
                            variant="tonal"
                            density="comfortable"
                            :disabled="current(fact.option) + stepOf(fact.option) > maxOf(fact.option)"
                            @click="setOption(fact.option, current(fact.option) + stepOf(fact.option))"
                          />
                        </template>
                      </v-tooltip>
                    </div>
                  </template>
                </li>
              </ul>
            </section>
          </div>

          <!-- Free, the full width under the paid columns -->
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
              <v-icon icon="mdi-star-four-points-outline" size="16" color="primary" class="me-1" />
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

.level-card {
  position: relative;
  overflow: hidden;
  gap: 14px;
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
  color: rgb(var(--v-theme-primary));
}

.level-card--popular {
  border: 2px solid rgba(var(--v-theme-primary), 0.7);
}

/* The user's own column: a solid gold border and a light gold wash. */
.level-card--current {
  border: 2px solid rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
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
  border: 2px solid rgb(var(--v-theme-primary));
  border-style: solid;
  background: rgba(var(--v-theme-primary), 0.06);
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
