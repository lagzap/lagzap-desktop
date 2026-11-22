<script setup lang="ts">
import { useLocale } from "vuetify";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { useRouteLevel } from "~/composables/useRouteLevel";
import { localDigits } from "~/utils/localeFormat";

/** A full-window fireworks show when the plan goes up: a paid plan where
 * there was none (or a trial), or a higher route level or bigger limits.
 * Renewals, same-level changes and downgrades show nothing. The last plan
 * seen is kept in localStorage, so a first purchase (which restarts the
 * service through the splash) is still noticed, and it shows only once. */

type Seen = { paid: boolean; hops: number; internets: number; routes: number; titles: number };
const SEEN_KEY = "plan-seen";

const { t } = useLocale();
const store = useStore();
const route = useRoute();
const plan = usePlanAccess();
const { levelName } = useRouteLevel();

const open = ref(false);
const planName = ref("");
const level = ref(0);
const internets = ref(0);

function readSeen(): Seen | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as Seen) : null;
  } catch {
    return null;
  }
}
function writeSeen(seen: Seen) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
  } catch {
    // storage blocked: shows at most once a run
  }
}

/** Higher somewhere and lower nowhere. */
function raised(before: Seen, now: Seen): boolean {
  if (now.paid && !before.paid) return true;
  if (!now.paid) return false;
  if (now.hops !== before.hops) return now.hops > before.hops;
  const keys = ["internets", "routes", "titles"] as const;
  return keys.some((k) => now[k] > before[k]) && keys.every((k) => now[k] >= before[k]);
}

watch(
  () => [plan.access.value, route.path] as const,
  ([access, path]) => {
    const status = access?.status ?? "loading";
    if (!access || status === "loading" || status === "unavailable" || status === "admin") return;
    // Not over the splash: once the app is showing.
    if (path.startsWith("/start-service")) return;
    const limits = access.limits;
    const now: Seen = {
      paid: status === "active",
      hops: limits?.max_hops ?? 0,
      internets: limits?.max_internets ?? 0,
      routes: limits?.max_routes ?? 0,
      titles: limits?.max_active_titles ?? 0,
    };
    const before = readSeen();
    writeSeen(now);
    if (!before || !raised(before, now)) return;
    planName.value = access.name || levelName(now.hops);
    level.value = now.hops;
    internets.value = now.internets;
    open.value = true;
  },
  { immediate: true },
);

/** Locations the plan opens now. */
const locations = computed(
  () => Object.values(store.nodes).filter((n) => !plan.nodeLocked(n.id) && plan.access.value?.nodes?.[n.id] !== "hidden").length,
);

// Fireworks: rockets rise and burst into falling sparks, then fade out.
const canvas = ref<HTMLCanvasElement | null>(null);
type Spark = { x: number; y: number; vx: number; vy: number; life: number; color: string; rocket?: number };
const COLORS = ["#f3d77a", "#ffb347", "#ffffff", "#7fd1ff", "#ff7a9c"];
let sparks: Spark[] = [];
let frame = 0;
let timers: ReturnType<typeof setTimeout>[] = [];

function burst(x: number, y: number) {
  const color = COLORS[Math.floor(Math.random() * COLORS.length)]!;
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 1.2 + Math.random() * 3.6;
    sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color });
  }
}
function launch() {
  const c = canvas.value;
  if (!c) return;
  const x = c.width * (0.12 + Math.random() * 0.76);
  sparks.push({ x, y: c.height, vx: (Math.random() - 0.5) * 0.8, vy: -(7 + Math.random() * 3), life: 1, color: "#fff", rocket: c.height * (0.15 + Math.random() * 0.3) });
}
function draw() {
  const c = canvas.value;
  const ctx = c?.getContext("2d");
  if (!c || !ctx) return;
  ctx.clearRect(0, 0, c.width, c.height);
  sparks = sparks.filter((s) => s.life > 0);
  for (const s of sparks) {
    s.x += s.vx;
    s.y += s.vy;
    if (s.rocket !== undefined) {
      if (s.y <= s.rocket) {
        s.life = 0;
        burst(s.x, s.y);
      }
      ctx.fillStyle = "#fff";
      ctx.fillRect(s.x, s.y, 2, 7);
      continue;
    }
    s.vy += 0.05;
    s.vx *= 0.985;
    s.vy *= 0.985;
    s.life -= 0.011;
    ctx.globalAlpha = Math.max(s.life, 0);
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  frame = requestAnimationFrame(draw);
}
function startShow() {
  const c = canvas.value;
  if (!c) return;
  c.width = c.clientWidth;
  c.height = c.clientHeight;
  sparks = [];
  for (let i = 0; i < 14; i++) timers.push(setTimeout(launch, i * 280));
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(draw);
}
function stopShow() {
  timers.forEach(clearTimeout);
  timers = [];
  cancelAnimationFrame(frame);
  sparks = [];
}
watch(open, (isOpen) => (isOpen ? nextTick(startShow) : stopShow()));
onBeforeUnmount(stopShow);
</script>

<template>
  <Transition name="plan-upgrade">
    <div v-if="open" class="plan-upgrade" role="dialog" aria-modal="true" @click.self="open = false">
      <canvas ref="canvas" class="plan-upgrade__fx" />
      <div class="plan-upgrade__body">
        <div class="plan-upgrade__title">{{ t("$vuetify.plan.upgraded.title", planName) }}</div>
        <div class="plan-upgrade__sub">{{ t("$vuetify.plan.upgraded.subtitle") }}</div>
        <div class="plan-upgrade__card">
          <div v-if="level > 0" class="plan-upgrade__row">
            <v-icon icon="mdi-routes" size="20" color="amber" />
            {{ t("$vuetify.plan.upgraded.routeLevel", levelName(level)) }}
          </div>
          <div v-if="locations > 0" class="plan-upgrade__row">
            <v-icon icon="mdi-earth" size="20" color="amber" />
            {{ t("$vuetify.plan.upgraded.locations", localDigits(locations)) }}
          </div>
          <div v-if="internets > 1" class="plan-upgrade__row">
            <v-icon icon="mdi-lan" size="20" color="amber" />
            {{ t("$vuetify.plan.upgraded.internets", localDigits(internets)) }}
          </div>
          <v-btn class="mt-3" color="amber" variant="flat" rounded="pill" block @click="open = false">
            {{ t("$vuetify.plan.upgraded.start") }}
          </v-btn>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.plan-upgrade {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.62);
}
.plan-upgrade__fx {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.plan-upgrade__body {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  animation: plan-upgrade-rise 0.7s cubic-bezier(0.2, 1.2, 0.4, 1) both;
}
.plan-upgrade__title {
  font-size: 40px;
  font-weight: 600;
  color: #fff;
  text-align: center;
}
.plan-upgrade__sub {
  margin: 4px 0 20px;
  font-size: 15px;
  color: #f3d77a;
}
.plan-upgrade__card {
  width: 340px;
  padding: 14px 18px 16px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  animation: plan-upgrade-rise 0.7s 0.35s cubic-bezier(0.2, 1.2, 0.4, 1) both;
}
.plan-upgrade__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 0;
  font-size: 14px;
}
.plan-upgrade__row + .plan-upgrade__row {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
@keyframes plan-upgrade-rise {
  from {
    opacity: 0;
    transform: translateY(28px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.plan-upgrade-enter-active,
.plan-upgrade-leave-active {
  transition: opacity 0.35s;
}
.plan-upgrade-enter-from,
.plan-upgrade-leave-to {
  opacity: 0;
}
</style>
