<script lang="ts" setup>
import { useTheme } from "vuetify";

const LOGO_BOX = 150;
const LOADER_OUTSET = 18;
const INNER_RING_INSET = 8;
const CX = LOGO_BOX / 2 + LOADER_OUTSET; // 93
const CY = CX;
const OUTER_R = CX - 1; // 92
const INNER_R = CX - INNER_RING_INSET - 1; // 84
const LOADER_SIZE = CX * 2; // 186
const STROKE = 1.75;
/** Tip marker diameter ≈ 1.15 × stroke. */
const TIP_R = (STROKE * 1.15) / 2;

const theme = useTheme();
const store = useStore();
const isDark = computed(() => theme.current.value.dark);

const props = withDefaults(
  defineProps<{
    loading?: boolean;
  }>(),
  { loading: true }
);

const optimizing = computed(() => store.optimizing);
/** Raw optimize progress 0–100. */
const realProgress = computed(() => {
  const completed = store.optimizeProgress?.completed_tests ?? 0;
  const total = store.optimizeProgress?.total_tests ?? 0;
  if (total > 0) {
    return Math.min(100, Math.max(0, (completed / total) * 100));
  }
  return Math.min(100, Math.max(0, store.optimizeProgress?.progress ?? 0));
});

/** Keep optimize UI mounted through inner→outer completion fade. */
const showOptimizeUi = ref(false);
const fadeInner = ref(false);
const fadeOuter = ref(false);
const holdComplete = ref(false);
let fadeToken = 0;

/** Feel-good display progress — stays active until fade finishes. */
const progressPct = usePsychoProgress(
  realProgress,
  computed(() => optimizing.value || showOptimizeUi.value)
);

/** Frozen at 100 while fading out so arcs don't collapse. */
const visualPct = computed(() =>
  holdComplete.value ? 100 : progressPct.value
);

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function runCompletionFade() {
  const token = ++fadeToken;
  holdComplete.value = true;
  clearDots();
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  fadeInner.value = true;
  await sleep(340);
  if (token !== fadeToken) return;
  fadeOuter.value = true;
  await sleep(340);
  if (token !== fadeToken) return;
  showOptimizeUi.value = false;
  fadeInner.value = false;
  fadeOuter.value = false;
  holdComplete.value = false;
}

const outerLen = 2 * Math.PI * OUTER_R;
const innerLen = 2 * Math.PI * INNER_R;

const outerDash = computed(
  () => `${(visualPct.value / 100) * outerLen} ${outerLen}`
);
const innerDash = computed(
  () => `${(visualPct.value / 100) * innerLen} ${innerLen}`
);

/** Continuous spin — inner slower and opposite. */
const OUTER_SPIN_REV_S = 0.35;
const INNER_SPIN_REV_S = 0.18; // ~half of outer
const outerSpinRad = ref(0);
const innerSpinRad = ref(0);
const outerSpinTransform = computed(
  () => `rotate(${(outerSpinRad.value * 180) / Math.PI} ${CX} ${CY})`
);
const innerSpinTransform = computed(
  () => `rotate(${(innerSpinRad.value * 180) / Math.PI} ${CX} ${CY})`
);

/**
 * Local tip angles (before spin): outer grows CW from 12 (unchanged),
 * inner always opposite (CCW). World tip = local + spin.
 */
function tipPoint(radius: number, localA: number, spin: number) {
  const a = localA + spin;
  return {
    x: CX + Math.cos(a) * radius,
    y: CY + Math.sin(a) * radius,
    a,
  };
}

function outerLocalAngle(pct: number) {
  return -Math.PI / 2 + (pct / 100) * Math.PI * 2;
}

function innerLocalAngle(pct: number) {
  return -Math.PI / 2 - (pct / 100) * Math.PI * 2;
}

const outerTip = computed(() =>
  tipPoint(OUTER_R, outerLocalAngle(visualPct.value), outerSpinRad.value)
);
const innerTip = computed(() =>
  tipPoint(INNER_R, innerLocalAngle(visualPct.value), innerSpinRad.value)
);

/** Local tip coords for markers inside each spinning group (no spin). */
const outerTipLocal = computed(() =>
  tipPoint(OUTER_R, outerLocalAngle(visualPct.value), 0)
);
const innerTipLocal = computed(() =>
  tipPoint(INNER_R, innerLocalAngle(visualPct.value), 0)
);

// Outer CW (do not flip), inner CCW — always opposite.
const outerTransform = `rotate(-90 ${CX} ${CY})`;
const innerTransform = `translate(${CX} ${CY}) scale(-1 1) translate(${-CX} ${-CY}) rotate(-90 ${CX} ${CY})`;

const sparkLayer = ref<SVGGElement | null>(null);
let raf = 0;
let spawnAcc = 0;
let lastTs = 0;
const liveSparks = new Set<SVGCircleElement>();

const goldDots = [
  "#b4832f",
  "#ccaa57",
  "#dbc572",
  "#e6d785",
  "#efe694",
  "#b87f2b",
];

function sparkBudget() {
  const completed = store.optimizeProgress?.completed_tests ?? 0;
  return Math.max(8, Math.min(80, completed || 24));
}

function sparkSpeed() {
  const p = progressPct.value;
  return Math.max(1, Math.min(10, Math.round((p / 100) * 4) + 1));
}

type TipKind = "outer" | "inner";

function spawnDot(kind: TipKind = Math.random() < 0.5 ? "outer" : "inner") {
  const g = sparkLayer.value;
  if (!g || progressPct.value < 1) {
    return false;
  }

  const speed = sparkSpeed();
  const tip = kind === "outer" ? outerTip.value : innerTip.value;
  const { x: tipX, y: tipY, a: tipA } = tip;
  const color = goldDots[Math.floor(Math.random() * goldDots.length)];

  // Outer dots slightly larger.
  const base = kind === "outer" ? 2.15 : 1.35;
  const size = base * (0.75 + Math.random() * 0.55);

  const originX = tipX + (Math.random() - 0.5) * 1.5;
  const originY = tipY + (Math.random() - 0.5) * 1.5;

  // Tangential spray + outward bias so particles leave the ring.
  const tangent = kind === "outer" ? Math.PI / 2 : -Math.PI / 2;
  const throwA = tipA + tangent + (Math.random() - 0.5) * 0.45;
  const outward = 0.35 + Math.random() * 0.35;
  const dist = 22 + Math.random() * 48 * (0.55 + speed * 0.12);
  const tx = Math.cos(throwA);
  const ty = Math.sin(throwA);
  const ox = Math.cos(tipA);
  const oy = Math.sin(tipA);
  const mx = tx * (1 - outward) + ox * outward;
  const my = ty * (1 - outward) + oy * outward;
  const mLen = Math.hypot(mx, my) || 1;
  const dx = (mx / mLen) * dist;
  const dy = (my / mLen) * dist;
  const dur = ((0.32 + Math.random() * 0.42) / (0.75 + speed * 0.12)) * 1000;

  const el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  el.setAttribute("fill", color);
  g.appendChild(el);
  liveSparks.add(el);

  const r0 = size / 2;
  const anim = el.animate(
    [
      {
        opacity: 0,
        cx: originX,
        cy: originY,
        r: r0 * 0.5,
      },
      {
        opacity: 1,
        cx: originX + dx * 0.12,
        cy: originY + dy * 0.12,
        r: r0,
        offset: 0.1,
      },
      {
        opacity: 0,
        cx: originX + dx,
        cy: originY + dy,
        r: r0 * 0.35,
      },
    ],
    { duration: dur, easing: "linear", fill: "forwards" }
  );

  const cleanup = () => {
    liveSparks.delete(el);
    el.remove();
  };
  anim.finished.then(cleanup).catch(cleanup);
  setTimeout(cleanup, dur + 100);
  return true;
}

function tick(ts: number) {
  if (!optimizing.value) {
    raf = 0;
    lastTs = 0;
    return;
  }
  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60;
  lastTs = ts;

  // Outer CW spin; inner slower + opposite (CCW).
  const speedMul = 0.85 + sparkSpeed() * 0.04;
  outerSpinRad.value += OUTER_SPIN_REV_S * Math.PI * 2 * speedMul * dt;
  innerSpinRad.value -= INNER_SPIN_REV_S * Math.PI * 2 * speedMul * dt;

  const perSec = 14 + sparkSpeed() * 12 + sparkBudget() * 0.1;
  spawnAcc += perSec * dt;
  while (spawnAcc >= 1 && liveSparks.size < sparkBudget()) {
    if (!spawnDot()) {
      spawnAcc = Math.min(spawnAcc, 1);
      break;
    }
    spawnAcc -= 1;
  }
  if (spawnAcc > 4) spawnAcc = 4;
  raf = requestAnimationFrame(tick);
}

function clearDots() {
  liveSparks.forEach((el) => el.remove());
  liveSparks.clear();
}

watch(
  optimizing,
  async (on) => {
    if (on) {
      fadeToken += 1;
      fadeInner.value = false;
      fadeOuter.value = false;
      holdComplete.value = false;
      showOptimizeUi.value = true;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      clearDots();
      lastTs = 0;
      outerSpinRad.value = 0;
      innerSpinRad.value = 0;
      await nextTick();
      spawnAcc = 1;
      raf = requestAnimationFrame(tick);
      return;
    }

    if (showOptimizeUi.value && !fadeInner.value) {
      await runCompletionFade();
    } else if (!showOptimizeUi.value) {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      clearDots();
      lastTs = 0;
    }
  },
  { immediate: true }
);

watch(progressPct, (p) => {
  if (p >= 100 && showOptimizeUi.value && !fadeInner.value) {
    void runCompletionFade();
  }
});

/** Parent stops loading when ready — drop arcs/pulse immediately. */
watch(
  () => props.loading,
  (on) => {
    if (on) return;
    fadeToken += 1;
    showOptimizeUi.value = false;
    fadeInner.value = false;
    fadeOuter.value = false;
    holdComplete.value = false;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    clearDots();
    lastTs = 0;
  }
);

onUnmounted(() => {
  fadeToken += 1;
  if (raf) cancelAnimationFrame(raf);
  clearDots();
});
</script>

<template>
  <div class="animated-logo-container">
    <div class="logo-container">
      <!-- Normal spin loader -->
      <div
        v-if="loading && !showOptimizeUi"
        class="logo-loader"
        :class="{ 'logo-loader--light': !isDark }"
        aria-hidden="true"
      >
        <span class="logo-loader__ring" />
        <span class="logo-loader__ring logo-loader__ring--delayed" />
      </div>

      <!-- Optimize: progress arcs — fades inner then outer on complete -->
      <div
        v-else-if="loading && showOptimizeUi"
        class="logo-loader logo-loader--optimize"
        :class="{ 'logo-loader--light': !isDark }"
        aria-hidden="true"
      >
        <svg
          class="logo-progress"
          :width="LOADER_SIZE"
          :height="LOADER_SIZE"
          :viewBox="`0 0 ${LOADER_SIZE} ${LOADER_SIZE}`"
        >
          <circle
            class="logo-progress__track"
            :class="{ 'logo-progress__fade': fadeOuter }"
            :cx="CX"
            :cy="CY"
            :r="OUTER_R"
            fill="none"
            :stroke-width="STROKE"
          />
          <circle
            class="logo-progress__track"
            :class="{ 'logo-progress__fade': fadeInner }"
            :cx="CX"
            :cy="CY"
            :r="INNER_R"
            fill="none"
            :stroke-width="STROKE"
          />

          <g
            class="logo-progress__group"
            :class="{ 'logo-progress__fade': fadeOuter }"
            :transform="outerSpinTransform"
          >
            <circle
              :cx="CX"
              :cy="CY"
              :r="OUTER_R"
              fill="none"
              :stroke-width="STROKE"
              stroke-linecap="round"
              :stroke-dasharray="outerDash"
              :transform="outerTransform"
              class="logo-progress__arc logo-progress__arc--outer"
            />
            <circle
              v-if="visualPct > 0.4"
              :cx="outerTipLocal.x"
              :cy="outerTipLocal.y"
              :r="TIP_R"
              class="logo-progress__tip logo-progress__tip--outer"
            />
          </g>

          <g
            class="logo-progress__group"
            :class="{ 'logo-progress__fade': fadeInner }"
            :transform="innerSpinTransform"
          >
            <circle
              :cx="CX"
              :cy="CY"
              :r="INNER_R"
              fill="none"
              :stroke-width="STROKE"
              stroke-linecap="round"
              :stroke-dasharray="innerDash"
              :transform="innerTransform"
              class="logo-progress__arc logo-progress__arc--inner"
            />
            <circle
              v-if="visualPct > 0.4"
              :cx="innerTipLocal.x"
              :cy="innerTipLocal.y"
              :r="TIP_R * 0.92"
              class="logo-progress__tip logo-progress__tip--inner"
            />
          </g>

          <g ref="sparkLayer" />
        </svg>
      </div>

      <LagzapLogo
        class="splash-logo"
        :class="{
          'animated-logo': loading,
          'animated-logo--light': loading && !isDark,
        }"
      />
    </div>
  </div>
</template>

<style>
.animated-logo-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: transparent;
  overflow: hidden;
  pointer-events: none;
  z-index: 1000;
}

.logo-container {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 150px;
  height: 150px;
  z-index: 1001;
}

.logo-loader {
  position: absolute;
  inset: -18px;
  z-index: 0;
}

.logo-loader--optimize {
  opacity: 0;
  animation: loaderFadeIn 0.45s ease forwards;
}

.logo-progress {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.logo-progress__track {
  stroke: rgba(180, 131, 47, 0.14);
}

.logo-loader--light .logo-progress__track {
  stroke: rgba(180, 131, 47, 0.16);
}

.logo-progress__arc {
  transition: stroke-dasharray 0.28s ease;
}

.logo-progress__group,
.logo-progress__track {
  transition: opacity 0.34s ease;
  opacity: 1;
}

.logo-progress__fade {
  opacity: 0;
}

/* Match the primary gold metals */
.logo-progress__arc--outer {
  stroke: #e6d785;
}

.logo-progress__arc--inner {
  stroke: #ccaa57;
}

.logo-progress__tip--outer {
  fill: #efe694;
}

.logo-progress__tip--inner {
  fill: #dbc572;
}

.logo-loader--light .logo-progress__arc--outer {
  stroke: #dbc572;
}

.logo-loader--light .logo-progress__arc--inner {
  stroke: #b88935;
}

.logo-loader--light .logo-progress__tip--outer {
  fill: #e6d785;
}

.logo-loader--light .logo-progress__tip--inner {
  fill: #ccaa57;
}

.logo-loader__ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: #e6d785;
  border-right-color: rgba(180, 131, 47, 0.35);
  animation: logoSpin 1.1s linear infinite;
}

.logo-loader__ring--delayed {
  inset: 8px;
  border-top-color: #ccaa57;
  border-right-color: transparent;
  animation-duration: 1.6s;
  animation-direction: reverse;
}

.logo-loader--light .logo-loader__ring {
  border-top-color: #dbc572;
  border-right-color: rgba(180, 131, 47, 0.3);
}

.logo-loader--light .logo-loader__ring--delayed {
  border-top-color: #b88935;
  border-right-color: transparent;
}

/* Bolt tips reach the box corners — inset so they stay inside the rings */
.logo-container .splash-logo.lagzap-logo-wrap {
  width: 70%;
  height: 70%;
  margin: 15%;
}

.animated-logo {
  position: relative;
  z-index: 1;
  filter: drop-shadow(0 0 14px rgba(180, 131, 47, 0.45));
  animation: logoGlow 1.4s ease-in-out infinite;
}

/* Light mode: badge disc already isolates the mark — no extra glow.
   Must nest under .animated-logo so pulse only runs while loading. */
.animated-logo.animated-logo--light {
  filter: none;
  animation: logoPulse 1.4s ease-in-out infinite;
}

@keyframes loaderFadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes logoSpin {
  to {
    transform: rotate(360deg);
  }
}

/* Scale only — never fade the logo */
@keyframes logoPulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(0.92);
  }
}

/* Glow uses logo gold (#b4832f), no opacity fade on the mark */
@keyframes logoGlow {
  0%,
  100% {
    filter: drop-shadow(0 0 12px rgba(180, 131, 47, 0.4));
    transform: scale(1);
  }
  50% {
    filter: drop-shadow(0 0 20px rgba(180, 131, 47, 0.55));
    transform: scale(0.92);
  }
}
</style>
