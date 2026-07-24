<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import Container from "~/components/layout/Container.vue";
import { useLocale } from "vuetify";
import { useNetworkReport } from "~/composables/useNetworkReport";
import { useNetworkHistoryConsent } from "~/composables/useNetworkHistoryConsent";
import type {
  NetworkReportRange,
  SkipReasonCategory,
} from "~/utils/networkReport";

const locale = useLocale();
const { t } = locale;
const router = useRouter();
const store = useStore();
const { isAuthenticated } = useSanctumAuth();
const { isAdmin, granted, canRecord, setGranted } = useNetworkHistoryConsent();

const {
  range,
  loading,
  clearing,
  report,
  error,
  insufficient,
  counts,
  rangeCounts,
  canGenerate,
  refreshCounts,
  refreshRangeCounts,
  generate,
  clearHistory,
  minSamples,
} = useNetworkReport();

const confirmClear = ref(false);

// Redirect non-admins once auth/abilities are known (avoid racing empty abilities).
watch(
  [isAuthenticated, () => store.abilities],
  () => {
    if (!isAuthenticated.value) {
      return;
    }
    if (!store.abilities.includes("admin")) {
      void router.replace({ name: "overview" });
    }
  },
  { immediate: true }
);

/** Rough minutes for the sample threshold (30s interval). */
const minMinutes = computed(() => Math.round((minSamples * 30) / 60));

const dataProgress = computed(() =>
  Math.min(100, Math.round((rangeCounts.value.samples / minSamples) * 100))
);

const rangeItems = computed(() => [
  {
    value: "24h" as NetworkReportRange,
    title: t("$vuetify.networkReport.range24h"),
  },
  {
    value: "7d" as NetworkReportRange,
    title: t("$vuetify.networkReport.range7d"),
  },
  {
    value: "30d" as NetworkReportRange,
    title: t("$vuetify.networkReport.range30d"),
  },
]);

function fmtMs(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${Math.round(value)}`;
}

function fmtMsUnit(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "";
  return "ms";
}

function fmtPct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function fmtHours(value: number) {
  if (!value) return "0";
  return value.toFixed(1);
}

function periodLabel(start: number, end: number) {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  return `${new Date(start).toLocaleString(undefined, opts)} – ${new Date(
    end
  ).toLocaleString(undefined, opts)}`;
}

function summaryText(key: string) {
  if (key === "pathSwapsHelped" && report.value) {
    const fixed = report.value.lagFix.verified;
    const saved = Math.round(report.value.lagFix.totalImprovementMs);
    if (saved > 0) {
      return t(
        "$vuetify.networkReport.summary.pathSwapsHelpedWithMs",
        fixed,
        saved
      );
    }
    return t("$vuetify.networkReport.summary.pathSwapsHelped", fixed);
  }
  return t(`$vuetify.networkReport.summary.${key}`);
}

function skipReasonText(key: SkipReasonCategory) {
  return t(`$vuetify.networkReport.skipReasons.${key}`);
}

function hourLabel(hour: number) {
  return t(
    "$vuetify.networkReport.hourOfDay",
    String(hour).padStart(2, "0")
  );
}

function maxSkipCount() {
  if (!report.value?.topSkipReasons.length) return 1;
  return Math.max(...report.value.topSkipReasons.map((r) => r.count), 1);
}

onMounted(async () => {
  await refreshCounts();
  await refreshRangeCounts();
  if (canGenerate.value) {
    void generate();
  } else {
    insufficient.value = true;
  }
});

watch(range, async () => {
  report.value = null;
  await refreshRangeCounts();
  if (canGenerate.value) {
    void generate();
  } else {
    insufficient.value = true;
  }
});

async function onClear() {
  await clearHistory();
  confirmClear.value = false;
}
</script>

<template>
  <div class="network-report-page">
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          {{ t("$vuetify.networkReport.title") }}
        </v-app-bar-title>
      </template>

      <div
        v-if="isAdmin"
        class="report-page"
      >
        <div class="report-atmosphere" aria-hidden="true" />

        <header class="report-hero">
          <p class="report-kicker">
            {{ t("$vuetify.networkReport.kicker") }}
          </p>
          <h1 class="report-headline">
            {{ t("$vuetify.networkReport.headline") }}
          </h1>
          <p class="report-lede">
            {{ t("$vuetify.networkReport.description") }}
          </p>

          <div
            v-if="!granted"
            class="need-data mb-2"
          >
            <div class="need-data__title">
              {{ t("$vuetify.networkReport.permissionRequired") }}
            </div>
            <p class="need-data__body">
              {{ t("$vuetify.networkReport.permissionRequiredBody") }}
            </p>
            <v-btn
              color="primary"
              rounded="lg"
              @click="setGranted(true)"
            >
              {{ t("$vuetify.networkReport.permissionAllow") }}
            </v-btn>
          </div>

          <template v-else>
          <div class="report-toolbar">
            <div class="range-pills">
              <button
                v-for="item in rangeItems"
                :key="item.value"
                type="button"
                class="range-pill"
                :class="{ 'range-pill--active': range === item.value }"
                @click="range = item.value"
              >
                {{ item.title }}
              </button>
            </div>
            <div class="report-toolbar__actions">
              <v-btn
                color="primary"
                rounded="lg"
                :loading="loading"
                :disabled="clearing || !canGenerate"
                @click="generate"
              >
                {{ t("$vuetify.networkReport.generate") }}
              </v-btn>
              <v-btn
                variant="text"
                rounded="lg"
                class="text-medium-emphasis"
                :disabled="loading || clearing"
                @click="confirmClear = true"
              >
                {{ t("$vuetify.networkReport.clear") }}
              </v-btn>
            </div>
          </div>

          <p class="report-meta">
            {{
              t(
                "$vuetify.networkReport.storedCounts",
                counts.samples,
                counts.events
              )
            }}
            <template v-if="canRecord">
              · {{ t("$vuetify.networkReport.recordingOn") }}
            </template>
          </p>
          </template>
        </header>

        <template v-if="granted">
        <v-alert
          v-if="error"
          type="error"
          density="compact"
          class="mx-6 mb-4"
          variant="tonal"
        >
          {{ error }}
        </v-alert>

        <div
          v-if="insufficient && !report"
          class="need-data mx-6 mb-6"
        >
          <div class="need-data__title">
            {{ t("$vuetify.networkReport.needMoreData") }}
          </div>
          <p class="need-data__body">
            {{
              t(
                "$vuetify.networkReport.needMoreDataBody",
                minSamples,
                minMinutes
              )
            }}
          </p>
          <p class="need-data__progress">
            {{
              t(
                "$vuetify.networkReport.needMoreDataProgress",
                rangeCounts.samples,
                minSamples,
                rangeCounts.events
              )
            }}
          </p>
          <div class="need-data__bar">
            <div
              class="need-data__bar-fill"
              :style="{ width: `${dataProgress}%` }"
            />
          </div>
        </div>

        <div
          v-if="loading && !report"
          class="d-flex justify-center py-16"
        >
          <v-progress-circular
            indeterminate
            color="primary"
          />
        </div>

        <div
          v-else-if="report"
          class="report-body"
        >
          <p class="report-period">
            {{ periodLabel(report.periodStart, report.periodEnd) }}
          </p>

          <section
            v-if="report.summaryKeys.length"
            class="report-story"
          >
            <p
              v-for="(key, index) in report.summaryKeys"
              :key="key"
              class="report-story__line"
              :style="{ animationDelay: `${index * 80}ms` }"
            >
              {{ summaryText(key) }}
            </p>
          </section>

          <section class="report-spotlight">
            <div class="spotlight-main">
              <div class="spotlight-main__label">
                {{ t("$vuetify.networkReport.medianLatency") }}
              </div>
              <div class="spotlight-main__value">
                <span>{{ fmtMs(report.latencyP50) }}</span>
                <small>{{ fmtMsUnit(report.latencyP50) }}</small>
              </div>
            </div>
            <div class="spotlight-side">
              <div class="spotlight-stat">
                <span class="spotlight-stat__label">
                  {{ t("$vuetify.networkReport.p95Latency") }}
                </span>
                <span class="spotlight-stat__value">
                  {{ fmtMs(report.latencyP95)
                  }}<small v-if="report.latencyP95 != null">ms</small>
                </span>
              </div>
              <div class="spotlight-stat">
                <span class="spotlight-stat__label">
                  {{ t("$vuetify.networkReport.avgLoss") }}
                </span>
                <span class="spotlight-stat__value">
                  {{ fmtPct(report.lossMean) }}
                </span>
              </div>
              <div class="spotlight-stat">
                <span class="spotlight-stat__label">
                  {{ t("$vuetify.networkReport.protectedTime") }}
                </span>
                <span class="spotlight-stat__value spotlight-stat__value--accent">
                  {{ fmtPct(report.protectedPct) }}
                </span>
              </div>
              <div class="spotlight-stat">
                <span class="spotlight-stat__label">
                  {{ t("$vuetify.networkReport.spikes") }}
                </span>
                <span class="spotlight-stat__value">
                  {{ report.spikeCount }}
                </span>
              </div>
            </div>
          </section>

          <p class="report-footnote">
            {{ t("$vuetify.networkReport.hoursActive") }}
            <strong>{{ fmtHours(report.hoursActive) }}</strong>
            ·
            {{ report.sampleCount }}
            {{ t("$vuetify.networkReport.samples") }}
          </p>

          <section class="report-section">
            <h2 class="report-section__title">
              {{ t("$vuetify.networkReport.interventions") }}
            </h2>

            <div class="fix-hero">
              <div class="fix-hero__main">
                <div class="fix-hero__value">
                  {{ report.lagFix.verified }}
                </div>
                <div class="fix-hero__label">
                  {{ t("$vuetify.networkReport.timesFixed") }}
                </div>
              </div>
              <div
                v-if="report.lagFix.totalImprovementMs > 0"
                class="fix-hero__saved"
              >
                <span class="fix-hero__saved-value"
                  >{{ Math.round(report.lagFix.totalImprovementMs) }} ms</span
                >
                <span class="fix-hero__saved-label">{{
                  t("$vuetify.networkReport.msSaved")
                }}</span>
              </div>
              <p
                v-else-if="report.lagFix.verified === 0"
                class="fix-hero__empty"
              >
                {{ t("$vuetify.networkReport.timesFixedEmpty") }}
              </p>
            </div>

            <div class="action-row">
              <div class="action-stat">
                <div class="action-stat__value">
                  {{ report.lagFix.skipped }}
                </div>
                <div class="action-stat__label">
                  {{ t("$vuetify.networkReport.skipped") }}
                </div>
              </div>
              <div class="action-stat">
                <div class="action-stat__value">
                  {{ report.lagFix.failed }}
                </div>
                <div class="action-stat__label">
                  {{ t("$vuetify.networkReport.failed") }}
                </div>
              </div>
              <div class="action-stat">
                <div class="action-stat__value">
                  {{
                    report.lagFix.verified +
                    report.lagFix.failed +
                    report.lagFix.skipped
                  }}
                </div>
                <div class="action-stat__label">
                  {{ t("$vuetify.networkReport.attemptsTotal") }}
                </div>
              </div>
            </div>
            <p class="action-note">
              {{ t("$vuetify.networkReport.userSide") }}
              <strong>{{ report.lagFix.userSide }}</strong>
              ·
              {{ t("$vuetify.networkReport.internetSide") }}
              <strong>{{ report.lagFix.internetSide }}</strong>
            </p>

            <div
              v-if="report.topSkipReasons.length"
              class="skip-block"
            >
              <h3 class="report-section__subtitle">
                {{ t("$vuetify.networkReport.whySkipped") }}
              </h3>
              <p class="report-section__hint">
                {{ t("$vuetify.networkReport.whySkippedHint") }}
              </p>
              <div
                v-for="bucket in report.topSkipReasons"
                :key="bucket.key"
                class="skip-row"
              >
                <div class="skip-row__top">
                  <span>{{ skipReasonText(bucket.key) }}</span>
                  <span class="skip-row__count">{{ bucket.count }}</span>
                </div>
                <div class="skip-bar">
                  <div
                    class="skip-bar__fill"
                    :style="{
                      width: `${Math.round(
                        (bucket.count / maxSkipCount()) * 100
                      )}%`,
                    }"
                  />
                </div>
              </div>
            </div>
          </section>

          <section
            v-if="report.bestByRegion.length || report.edgeCities.length"
            class="report-section"
          >
            <h2 class="report-section__title">
              {{ t("$vuetify.networkReport.edgeTitle") }}
            </h2>
            <p class="report-section__hint">
              <template v-if="report.primaryRegion">
                {{
                  t(
                    "$vuetify.networkReport.edgeHintFocused",
                    report.primaryRegion.label,
                    Math.round(report.primaryRegion.sharePct)
                  )
                }}
              </template>
              <template v-else>
                {{ t("$vuetify.networkReport.edgeHint") }}
              </template>
            </p>

            <p
              v-if="report.bestEdgeOverall && report.primaryRegion"
              class="edge-best-line"
            >
              {{
                t(
                  "$vuetify.networkReport.edgeBestInRegion",
                  report.primaryRegion.label,
                  report.bestEdgeOverall.city,
                  report.bestEdgeOverall.country ||
                    report.bestEdgeOverall.regionLabel,
                  Math.round(report.bestEdgeOverall.avgLatencyMs)
                )
              }}
            </p>
            <p
              v-else-if="report.bestEdgeOverall"
              class="edge-best-line"
            >
              {{
                t(
                  "$vuetify.networkReport.edgeBestOverall",
                  report.bestEdgeOverall.city,
                  report.bestEdgeOverall.country ||
                    report.bestEdgeOverall.regionLabel,
                  Math.round(report.bestEdgeOverall.avgLatencyMs)
                )
              }}
            </p>

            <div
              v-if="report.bestByRegion.length"
              class="mb-5"
            >
              <h3 class="report-section__subtitle">
                {{ t("$vuetify.networkReport.edgeBestByRegion") }}
              </h3>
              <div
                v-for="item in report.bestByRegion"
                :key="item.region"
                class="edge-region-row"
              >
                <div class="edge-region-row__main">
                  <span class="edge-region-row__region">
                    {{ item.regionLabel || item.region }}
                    <template v-if="item.usageSharePct > 0">
                      · {{ Math.round(item.usageSharePct) }}%
                    </template>
                  </span>
                  <span class="edge-region-row__city">
                    {{ item.city
                    }}<template v-if="item.country"
                      >, {{ item.country }}</template
                    >
                  </span>
                </div>
                <span class="edge-region-row__ms"
                  >{{ Math.round(item.avgLatencyMs) }} ms</span
                >
              </div>
            </div>

            <div v-if="report.edgeCities.length">
              <h3 class="report-section__subtitle">
                {{
                  report.primaryRegion
                    ? t(
                        "$vuetify.networkReport.edgeTopCitiesInRegion",
                        report.primaryRegion.label
                      )
                    : t("$vuetify.networkReport.edgeTopCities")
                }}
              </h3>
              <div class="edge-city-grid">
                <div
                  v-for="(item, index) in report.edgeCities"
                  :key="item.cityKey"
                  class="edge-city-card"
                  :style="{ animationDelay: `${index * 55}ms` }"
                >
                  <span class="edge-city-card__rank">{{ index + 1 }}</span>
                  <div class="edge-city-card__body">
                    <span class="edge-city-card__city">{{ item.city }}</span>
                    <span class="edge-city-card__sub">
                      <template v-if="item.country"
                        >{{ item.country }} · </template
                      >{{ item.regionLabel || item.region }}
                    </span>
                  </div>
                  <div class="edge-city-card__ms">
                    <span>{{ Math.round(item.avgLatencyMs) }}</span>
                    <small>ms</small>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section
            v-else-if="report.sampleCount > 0"
            class="report-section"
          >
            <h2 class="report-section__title">
              {{ t("$vuetify.networkReport.edgeTitle") }}
            </h2>
            <p class="report-section__hint">
              {{ t("$vuetify.networkReport.edgeEmpty") }}
            </p>
          </section>

          <section
            v-if="report.topCountries.length || report.topCities.length"
            class="report-section"
          >
            <h2 class="report-section__title">
              {{ t("$vuetify.networkReport.whereConnected") }}
            </h2>
            <p class="report-section__hint">
              {{ t("$vuetify.networkReport.whereConnectedHint") }}
            </p>
            <div class="place-grid">
              <div v-if="report.topCountries.length">
                <h3 class="report-section__subtitle">
                  {{ t("$vuetify.networkReport.topCountries") }}
                </h3>
                <div
                  v-for="item in report.topCountries"
                  :key="item.key"
                  class="place-row"
                >
                  <div class="place-row__top">
                    <CountryFlag
                      v-if="item.key.length === 2"
                      :country="item.key"
                      size="small"
                    />
                    <span>{{ item.label }}</span>
                    <span class="place-row__pct"
                      >{{ Math.round(item.sharePct) }}%</span
                    >
                  </div>
                  <div class="skip-bar">
                    <div
                      class="skip-bar__fill skip-bar__fill--soft"
                      :style="{ width: `${Math.round(item.sharePct)}%` }"
                    />
                  </div>
                </div>
              </div>
              <div v-if="report.topCities.length">
                <h3 class="report-section__subtitle">
                  {{ t("$vuetify.networkReport.topCities") }}
                </h3>
                <div
                  v-for="item in report.topCities"
                  :key="item.key"
                  class="place-row"
                >
                  <div class="place-row__top">
                    <span>{{ item.label }}</span>
                    <span class="place-row__pct"
                      >{{ Math.round(item.sharePct) }}%</span
                    >
                  </div>
                  <div class="skip-bar">
                    <div
                      class="skip-bar__fill skip-bar__fill--soft"
                      :style="{ width: `${Math.round(item.sharePct)}%` }"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section
            v-else-if="report.sampleCount > 0 && !report.edgeCities.length"
            class="report-section"
          >
            <h2 class="report-section__title">
              {{ t("$vuetify.networkReport.whereConnected") }}
            </h2>
            <p class="report-section__hint">
              {{ t("$vuetify.networkReport.whereConnectedEmpty") }}
            </p>
          </section>

          <section
            v-if="report.worstHours.length"
            class="report-section report-section--last"
          >
            <h2 class="report-section__title">
              {{ t("$vuetify.networkReport.worstHours") }}
            </h2>
            <div class="hour-strip">
              <div
                v-for="bucket in report.worstHours"
                :key="bucket.hour"
                class="hour-chip"
              >
                <span class="hour-chip__time">{{ hourLabel(bucket.hour) }}</span>
                <span class="hour-chip__stats">
                  {{ fmtMs(bucket.avgLatencyMs) }}ms ·
                  {{ fmtPct(bucket.avgLossPct) }}
                </span>
              </div>
            </div>
          </section>
        </div>
        </template>
      </div>
    </Container>

    <v-dialog
      v-model="confirmClear"
      max-width="420"
    >
      <v-card rounded="lg">
        <v-card-title>
          {{ t("$vuetify.networkReport.clearTitle") }}
        </v-card-title>
        <v-card-text>
          {{ t("$vuetify.networkReport.clearConfirm") }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="confirmClear = false"
          >
            {{ t("$vuetify.networkReport.clearCancel") }}
          </v-btn>
          <v-btn
            color="error"
            :loading="clearing"
            @click="onClear"
          >
            {{ t("$vuetify.networkReport.clearConfirmBtn") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.report-page {
  position: relative;
  min-height: 100%;
  padding-bottom: 3rem;
  overflow: hidden;
}

.report-atmosphere {
  pointer-events: none;
  position: absolute;
  inset: 0 0 auto 0;
  height: 280px;
  background:
    radial-gradient(
      90% 120% at 12% -10%,
      rgba(var(--v-theme-primary), 0.22),
      transparent 55%
    ),
    radial-gradient(
      70% 90% at 88% 0%,
      rgba(var(--v-theme-primary), 0.08),
      transparent 50%
    ),
    linear-gradient(
      180deg,
      rgba(var(--v-theme-on-surface), 0.04),
      transparent 70%
    );
}

.report-hero {
  position: relative;
  padding: 1.5rem 1.5rem 1.25rem;
  max-width: 760px;
}

.report-kicker {
  margin: 0 0 0.4rem;
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-primary), 0.95);
  font-weight: 600;
}

.report-headline {
  margin: 0 0 0.65rem;
  font-size: clamp(1.75rem, 3.2vw, 2.35rem);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.15;
}

.report-lede {
  margin: 0 0 1.25rem;
  max-width: 36rem;
  font-size: 0.95rem;
  line-height: 1.55;
  opacity: 0.72;
}

.report-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.85rem 1rem;
}

.range-pills {
  display: inline-flex;
  padding: 3px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.range-pill {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  opacity: 0.7;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 0.45rem 0.85rem;
  border-radius: 999px;
  cursor: pointer;
  transition:
    background 160ms ease,
    opacity 160ms ease,
    color 160ms ease;
}

.range-pill--active {
  opacity: 1;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.report-toolbar__actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.report-meta {
  margin: 0.85rem 0 0;
  font-size: 0.75rem;
  opacity: 0.55;
}

.need-data {
  position: relative;
  padding: 1.15rem 1.2rem 1.25rem;
  border-radius: 14px;
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
}

.need-data__title {
  font-weight: 700;
  letter-spacing: -0.02em;
  margin-bottom: 0.35rem;
}

.need-data__body {
  margin: 0 0 0.75rem;
  font-size: 0.9rem;
  line-height: 1.5;
  opacity: 0.8;
}

.need-data__progress {
  margin: 0 0 0.45rem;
  font-size: 0.75rem;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}

.need-data__bar {
  height: 5px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.1);
  overflow: hidden;
}

.need-data__bar-fill {
  height: 100%;
  border-radius: inherit;
  background: rgb(var(--v-theme-primary));
  min-width: 0;
  transition: width 400ms ease;
}

.report-body {
  position: relative;
  padding: 0 1.5rem 1rem;
  max-width: 760px;
  animation: report-in 420ms ease both;
}

@keyframes report-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.report-period {
  margin: 0 0 1.25rem;
  font-size: 0.75rem;
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
}

.report-story {
  margin-bottom: 1.75rem;
  padding: 1.1rem 0 1.25rem;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.1);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.1);
}

.report-story__line {
  margin: 0 0 0.55rem;
  font-size: 1.05rem;
  line-height: 1.55;
  letter-spacing: -0.01em;
  animation: story-in 480ms ease both;
}

.report-story__line:last-child {
  margin-bottom: 0;
}

@keyframes story-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.report-spotlight {
  display: grid;
  gap: 1.25rem;
  margin-bottom: 0.75rem;
}

@media (min-width: 640px) {
  .report-spotlight {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    align-items: end;
  }
}

.spotlight-main__label {
  font-size: 0.75rem;
  opacity: 0.6;
  margin-bottom: 0.35rem;
}

.spotlight-main__value {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  font-size: clamp(3rem, 7vw, 4.25rem);
  font-weight: 700;
  letter-spacing: -0.05em;
  line-height: 0.95;
  font-variant-numeric: tabular-nums;
}

.spotlight-main__value small {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0;
  opacity: 0.55;
}

.spotlight-side {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.85rem 1rem;
}

.spotlight-stat {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.spotlight-stat__label {
  font-size: 0.7rem;
  opacity: 0.55;
}

.spotlight-stat__value {
  font-size: 1.15rem;
  font-weight: 650;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}

.spotlight-stat__value small {
  font-size: 0.75rem;
  margin-inline-start: 0.15rem;
  opacity: 0.55;
}

.spotlight-stat__value--accent {
  color: rgb(var(--v-theme-primary));
}

.report-footnote {
  margin: 0 0 2rem;
  font-size: 0.8rem;
  opacity: 0.55;
}

.report-section {
  margin-bottom: 2rem;
  padding-top: 1.25rem;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}

.report-section--last {
  margin-bottom: 0;
}

.report-section__title {
  margin: 0 0 0.85rem;
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: -0.015em;
}

.report-section__subtitle {
  margin: 0 0 0.75rem;
  font-size: 0.8rem;
  font-weight: 600;
  opacity: 0.75;
}

.report-section__hint {
  margin: -0.35rem 0 1rem;
  font-size: 0.85rem;
  opacity: 0.6;
  line-height: 1.45;
}

.fix-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 1rem 1.5rem;
  margin-bottom: 1.15rem;
  padding: 1rem 1.1rem;
  border-radius: 14px;
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid rgba(var(--v-theme-primary), 0.2);
}

.fix-hero__value {
  font-size: clamp(2.4rem, 5vw, 3.25rem);
  font-weight: 750;
  letter-spacing: -0.05em;
  line-height: 0.95;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--v-theme-primary));
}

.fix-hero__label {
  margin-top: 0.35rem;
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.fix-hero__saved {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin-inline-start: auto;
}

.fix-hero__saved-value {
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
}

.fix-hero__saved-label {
  font-size: 0.72rem;
  opacity: 0.6;
}

.fix-hero__empty {
  margin: 0;
  flex: 1;
  min-width: 12rem;
  font-size: 0.85rem;
  line-height: 1.45;
  opacity: 0.7;
}

.action-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
  margin-bottom: 0.85rem;
}

.action-stat__value {
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.action-stat__label {
  margin-top: 0.2rem;
  font-size: 0.72rem;
  opacity: 0.55;
  line-height: 1.3;
}

.action-note {
  margin: 0;
  font-size: 0.85rem;
  opacity: 0.7;
}

.skip-block {
  margin-top: 1.35rem;
}

.skip-row,
.place-row {
  margin-bottom: 0.85rem;
}

.skip-row__top,
.place-row__top {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.35rem;
  font-size: 0.875rem;
  line-height: 1.35;
}

.skip-row__count,
.place-row__pct {
  margin-inline-start: auto;
  font-size: 0.75rem;
  opacity: 0.55;
  font-variant-numeric: tabular-nums;
}

.skip-bar {
  height: 5px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  overflow: hidden;
}

.skip-bar__fill {
  height: 100%;
  border-radius: inherit;
  background: rgb(var(--v-theme-primary));
  min-width: 4px;
  transition: width 500ms ease;
}

.skip-bar__fill--soft {
  opacity: 0.8;
}

.place-grid {
  display: grid;
  gap: 1.5rem;
}

@media (min-width: 700px) {
  .place-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.hour-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
}

.hour-chip {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.7rem 0.9rem;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.045);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  min-width: 7.5rem;
}

.hour-chip__time {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.hour-chip__stats {
  font-size: 0.75rem;
  opacity: 0.55;
  font-variant-numeric: tabular-nums;
}

.edge-best-line {
  margin: 0 0 1.15rem;
  font-size: 1.02rem;
  line-height: 1.5;
  letter-spacing: -0.01em;
}

.edge-region-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.65rem 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}

.edge-region-row:last-child {
  border-bottom: 0;
}

.edge-region-row__main {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
  flex: 1;
}

.edge-region-row__region {
  font-size: 0.72rem;
  opacity: 0.55;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
}

.edge-region-row__city {
  font-weight: 600;
  letter-spacing: -0.015em;
}

.edge-region-row__ms {
  font-variant-numeric: tabular-nums;
  font-weight: 650;
  color: rgb(var(--v-theme-primary));
  white-space: nowrap;
}

.edge-city-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.65rem;
}

@media (min-width: 520px) {
  .edge-city-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.edge-city-card {
  display: flex;
  align-items: flex-start;
  gap: 0.7rem;
  padding: 0.85rem 0.95rem;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.035);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  animation: story-in 420ms ease both;
}

.edge-city-card__rank {
  flex-shrink: 0;
  width: 1.55rem;
  height: 1.55rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 0.72rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}

.edge-city-card__body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.edge-city-card__city {
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.25;
}

.edge-city-card__sub {
  font-size: 0.72rem;
  opacity: 0.55;
  line-height: 1.3;
}

.edge-city-card__ms {
  display: flex;
  align-items: baseline;
  gap: 0.2rem;
  flex-shrink: 0;
  font-size: 1.15rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  color: rgb(var(--v-theme-primary));
}

.edge-city-card__ms small {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0;
  opacity: 0.55;
}
</style>
