<script setup lang="ts">
import { useLocale } from "vuetify";
import { System } from "@wailsio/runtime";
import Container from "~/components/layout/Container.vue";
import MultiInternetAdapterCard from "~/components/network/multi/MultiInternetAdapterCard.vue";
import HelpTip from "~/components/settings/HelpTip.vue";
import { localDigits } from "~/utils/localeFormat";
import { MAX_ROUTES } from "~/composables/routeCountUtils";
import { useNetworkAdapterSettings } from "~/composables/useNetworkAdapterSettings";
import { useNetworkMonitor } from "~/composables/useNetworkMonitor";
import { usePlanAccess } from "~/composables/usePlanAccess";

/** Which adapters LagZap uses: the default one, the ones joined together for
 * Multi Internet and the backups for prevent-disconnect. Only what matters
 * for choosing: each adapter's ping and a small chart. */
const { t } = useLocale();
const {
  defaultInterfaceOverride,
  defaultInterface,
  interfaces,
  multiInternet,
  backupInterfaces,
  loadBalance,
  isMetered,
  setMetered,
  globalTcpRoutes,
  globalUdpRoutes,
  resolvedGlobalTcp,
  resolvedGlobalUdp,
  getInterfaceRouteOverride,
  setGlobalTcp,
  setGlobalUdp,
  setInterfaceTcp,
  setInterfaceUdp,
} = useNetworkAdapterSettings();
const { settings, setRelayTransportFallback, setVirtualAdapter, setAdapterOrder } = useSettings();
const { monitor, colorOf } = useNetworkMonitor();

const names = computed(() => interfaces.value.map((iface) => iface.Name).filter(Boolean));

// The plan caps how many internets work together: Go uses the first ones in
// this page's order. Without an active plan none joins Multi Internet or
// backups, and route counts stop at the plan's.
const store = useStore();
const plan = usePlanAccess();
const maxInternets = computed(() => plan.limits.value?.max_internets ?? 0);
const planCapsInternets = computed(() => maxInternets.value > 0 && names.value.length > maxInternets.value);
const routeMax = computed(() => {
  const max = plan.limits.value?.max_routes ?? 0;
  return max > 0 ? Math.min(MAX_ROUTES, max) : MAX_ROUTES;
});
/** The adapter at this place in the order is outside the plan. */
const planLocked = (index: number) =>
  store.planBlocked || (maxInternets.value > 0 && index >= maxInternets.value);
const monitorOf = (name: string) => monitor.value?.interfaces?.find((iface) => iface.name === name);
const effectiveDefault = computed(() => defaultInterfaceOverride.value ?? defaultInterface.value);

// Each adapter's route counts live on its card; empty means the page default.
function routesOf(name: string) {
  if (!multiInternet.has(name)) return null;
  const own = getInterfaceRouteOverride(name);
  return { ...own, tcpDefault: resolvedGlobalTcp.value, udpDefault: resolvedGlobalUdp.value };
}

// Card order is the failover order: Default first, then the order the user
// dragged the cards into (backups take over in it). Adapters not ordered yet
// keep the system order at the end.
const orderedNames = computed(() => {
  const rank = new Map((settings.value.adapterOrder ?? []).map((name, i) => [name, i]));
  const pos = (name: string) => rank.get(name) ?? rank.size;
  const list = [...names.value].sort((a, b) => pos(a) - pos(b));
  const def = effectiveDefault.value;
  return def && list.includes(def) ? [def, ...list.filter((n) => n !== def)] : list;
});

function commitOrder(next: string[]) {
  // Whatever lands first is the Default.
  if (next[0] && next[0] !== effectiveDefault.value) {
    defaultInterfaceOverride.value = next[0];
  }
  void setAdapterOrder(next);
}

function setDefault(name: string, on: boolean) {
  defaultInterfaceOverride.value = on ? name : null;
  if (on) commitOrder([name, ...orderedNames.value.filter((n) => n !== name)]);
}

// Drag from the grip only, so chips and route inputs keep working. Pointer
// events, not HTML drag and drop: the app's WebView does not deliver the
// latter reliably. The card follows the pointer; on drop the cards slide
// into their new places (FLIP), the dropped one from where it was let go.
// More settings open on every card at once, so cards in a row stay level.
const cardsExpanded = ref(false);

const dragging = ref<string | null>(null);
const dropTarget = ref<string | null>(null);
let dragEl: HTMLElement | null = null;
let dragStart = { x: 0, y: 0 };

function slotEl(name: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.adapter-slot[data-adapter="${CSS.escape(name)}"]`);
}

/** The card under the pointer, the dragged one left out. */
function slotUnder(x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const slot = el.closest<HTMLElement>("[data-adapter]");
    if (slot && slot.dataset.adapter !== dragging.value) return slot.dataset.adapter ?? null;
  }
  return null;
}

function onGripDown(name: string, event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  dragging.value = name;
  dropTarget.value = null;
  dragEl = slotEl(name);
  dragStart = { x: event.clientX, y: event.clientY };
  document.body.classList.add("adapter-dragging");
}

function onGripMove(event: PointerEvent) {
  if (!dragging.value || !dragEl) return;
  const dx = event.clientX - dragStart.x;
  const dy = event.clientY - dragStart.y;
  dragEl.style.transform = `translate(${dx}px, ${dy}px) scale(1.02)`;
  dropTarget.value = slotUnder(event.clientX, event.clientY);
}

async function onGripUp() {
  const el = dragEl;
  const from = orderedNames.value.indexOf(dragging.value ?? "");
  const to = orderedNames.value.indexOf(dropTarget.value ?? "");
  // Where every card is drawn now, the dragged one where it was let go.
  const before = new Map(orderedNames.value.map((n) => [n, slotEl(n)?.getBoundingClientRect()]));
  onDragEnd();
  if (el) el.style.transform = "";
  if (from >= 0 && to >= 0 && from !== to) {
    const next = [...orderedNames.value];
    next.splice(to, 0, ...next.splice(from, 1));
    commitOrder(next);
    await nextTick();
  }
  slideFrom(before);
}

/** Moves each card from its old rect to where it is now. */
function slideFrom(before: Map<string, DOMRect | undefined>) {
  for (const [name, old] of before) {
    const el = slotEl(name);
    if (!el || !old) continue;
    const now = el.getBoundingClientRect();
    const dx = old.left - now.left;
    const dy = old.top - now.top;
    if (!dx && !dy) continue;
    el.style.transition = "none";
    el.style.transform = `translate(${dx}px, ${dy}px)`;
    void el.offsetWidth;
    el.style.transition = "transform 0.22s cubic-bezier(0.2, 0, 0, 1)";
    el.style.transform = "";
    el.addEventListener("transitionend", () => (el.style.transition = ""), { once: true });
  }
}

function onDragEnd() {
  dragging.value = dropTarget.value = null;
  dragEl = null;
  document.body.classList.remove("adapter-dragging");
}
onUnmounted(onDragEnd);

// Capture mode is a Windows choice: NDIS by default, the virtual adapter
// (TUN) on request. Elsewhere the TUN is the only mode.
const isWindows = System.IsWindows();
const virtualAdapterBusy = ref(false);
const virtualAdapterError = ref("");
async function toggleVirtualAdapter(on: boolean) {
  if (virtualAdapterBusy.value || (settings.value.virtualAdapter === true) === on) return;
  virtualAdapterBusy.value = true;
  virtualAdapterError.value = "";
  try {
    await setVirtualAdapter(on);
  } catch {
    virtualAdapterError.value = t("$vuetify.settings.multiInternetPage.virtualAdapterFailed");
  } finally {
    virtualAdapterBusy.value = false;
  }
}

const mi = (key: string) => t(`$vuetify.settings.multiInternetPage.${key}`);
const captureModes = computed(() => [
  {
    virtual: false,
    icon: "mdi-ethernet",
    title: mi("captureStandard"),
    badge: mi("captureRecommended"),
    summary: mi("captureStandardSummary"),
    pros: [mi("captureStandardPro1"), mi("captureStandardPro2"), mi("captureStandardPro3"), mi("captureStandardPro4")],
    cons: [mi("captureStandardCon1")],
  },
  {
    virtual: true,
    icon: "mdi-lan-connect",
    title: mi("captureVirtual"),
    badge: "",
    summary: mi("captureVirtualSummary"),
    pros: [mi("captureVirtualPro1"), mi("captureVirtualPro2")],
    cons: [mi("captureVirtualCon4"), mi("captureVirtualCon1"), mi("captureVirtualCon2"), mi("captureVirtualCon3")],
  },
]);
const virtualOn = computed(() => settings.value.virtualAdapter === true);

// Every adapter in each pool, set in Settings.
const pools = computed(() => [
  { key: "multi", pool: multiInternet, title: mi("multi"), hint: mi("autoMultiHint") },
  { key: "backup", pool: backupInterfaces, title: mi("backup"), hint: mi("autoBackupHint") },
  { key: "loadBalance", pool: loadBalance, title: mi("loadBalance"), hint: mi("autoLoadBalanceHint") },
]);
const poolsLocked = computed(() => store.planBlocked || planCapsInternets.value);
function setPool(pool: { auto: { value: boolean } }, on: boolean) {
  if (!poolsLocked.value) pool.auto.value = on;
}

// Routes per adapter: a stepper per transport; empty means the default.
const routeSteppers = computed(() => [
  {
    key: "tcp",
    label: mi("tcp"),
    hint: mi("routesTcpHint"),
    custom: globalTcpRoutes.value,
    value: resolvedGlobalTcp.value,
    set: setGlobalTcp,
  },
  {
    key: "udp",
    label: mi("udp"),
    hint: mi("routesUdpHint"),
    custom: globalUdpRoutes.value,
    value: resolvedGlobalUdp.value,
    set: setGlobalUdp,
  },
]);
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          {{ t("$vuetify.navigation.multiInternet") }}
          <HelpTip class="ms-1" :text="mi('description')" />
        </v-app-bar-title>
      </template>

      <div class="multi-internet pa-4">
        <v-alert
          v-if="names.length === 1"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-4"
          :text="t('$vuetify.settings.multiInternetPage.singleNote')"
        />
        <v-alert
          v-if="planCapsInternets"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-4"
          :text="t('$vuetify.settings.multiInternetPage.planInternets', localDigits(maxInternets))"
        />

        <div v-if="names.length" class="multi-internet__grid">
          <div
            v-for="(name, index) in orderedNames"
            :key="name"
            class="adapter-slot"
            :class="{
              'adapter-slot--dragging': dragging === name,
              'adapter-slot--drop': dropTarget === name && dragging !== name,
            }"
            :data-adapter="name"
          >
            <v-tooltip location="top" :text="mi('orderTip')" open-delay="400">
              <template #activator="{ props: tip }">
                <div
                  v-bind="tip"
                  class="adapter-slot__grip"
                  role="button"
                  :aria-label="mi('orderTip')"
                  @pointerdown="onGripDown(name, $event)"
                  @pointermove="onGripMove"
                  @pointerup="onGripUp"
                  @pointercancel="onDragEnd"
                >
                  <v-icon icon="mdi-drag" size="16" />
                  <span class="adapter-slot__rank">{{ localDigits(index + 1) }}</span>
                </div>
              </template>
            </v-tooltip>
            <MultiInternetAdapterCard
              v-model:expanded="cardsExpanded"
              :name="name"
              :monitor="monitorOf(name)"
              :color="colorOf(name)"
              :is-default="name === effectiveDefault"
              :default-pinned="defaultInterfaceOverride === name"
              :in-multi="multiInternet.has(name)"
              :can-leave-multi="multiInternet.canRemove(name)"
              :in-backup="backupInterfaces.has(name)"
              :can-leave-backup="backupInterfaces.canRemove(name)"
              :in-load-balance="loadBalance.has(name)"
              :can-leave-load-balance="loadBalance.canRemove(name)"
              :metered="isMetered(name)"
              :routes="routesOf(name)"
              :plan-locked="planLocked(index)"
              :unlock-internets="index + 1"
              :route-max="routeMax"
              @set-default="setDefault(name, $event)"
              @set-multi="multiInternet.toggle(name, $event)"
              @set-backup="backupInterfaces.toggle(name, $event)"
              @set-load-balance="loadBalance.toggle(name, $event)"
              @set-metered="setMetered(name, $event)"
              @set-tcp="setInterfaceTcp(name, $event)"
              @set-udp="setInterfaceUdp(name, $event)"
            />
          </div>
        </div>
        <div v-else class="text-body-2 text-medium-emphasis py-6 text-center">
          {{ t("$vuetify.networkLatency.monitor.noInterfaces") }}
        </div>

        <!-- Settings: the routes every Multi Internet card uses unless it
             sets its own, and whether every adapter is in each pool. -->
        <section class="mi-section mt-8">
          <div class="mi-section__head">
            <span class="text-subtitle-2">{{ mi("settingsTitle") }}</span>
            <HelpTip :text="mi('routesDescription')" />
          </div>
          <div class="lz-panel">
            <div class="mi-routes">
              <div v-for="step in routeSteppers" :key="step.key" class="mi-route">
                <div class="mi-route__text">
                  <div class="d-flex align-center ga-2">
                    <span class="text-body-2 font-weight-medium">{{ step.label }}</span>
                    <v-chip v-if="step.custom === null" size="x-small" variant="tonal">
                      {{ mi("routesAuto") }}
                    </v-chip>
                    <v-btn
                      v-else
                      v-tooltip="mi('routesReset')"
                      icon="mdi-restore"
                      size="x-small"
                      variant="text"
                      density="comfortable"
                      :aria-label="mi('routesReset')"
                      :disabled="store.planBlocked"
                      @click="step.set(null)"
                    />
                  </div>
                  <div class="text-caption text-medium-emphasis">{{ step.hint }}</div>
                </div>
                <div class="mi-stepper" :class="{ 'mi-stepper--disabled': store.planBlocked }">
                  <v-btn
                    icon="mdi-minus"
                    size="small"
                    variant="text"
                    density="comfortable"
                    :disabled="store.planBlocked || step.value <= 0"
                    @click="step.set(step.value - 1)"
                  />
                  <span class="mi-stepper__value lz-num">{{ localDigits(step.value) }}</span>
                  <v-btn
                    icon="mdi-plus"
                    size="small"
                    variant="text"
                    density="comfortable"
                    :disabled="store.planBlocked || step.value >= routeMax"
                    @click="step.set(step.value + 1)"
                  />
                </div>
              </div>
            </div>
            <v-divider />
            <div class="mi-route">
              <div class="mi-route__text">
                <div class="text-body-2 font-weight-medium">{{ t("$vuetify.settings.route.transportFallback") }}</div>
                <div class="text-caption text-medium-emphasis">{{ t("$vuetify.settings.route.transportFallbackHint") }}</div>
              </div>
              <v-switch
                :model-value="settings.relayTransportFallback"
                color="primary"
                density="compact"
                hide-details
                inset
                class="flex-grow-0"
                @update:model-value="(on) => setRelayTransportFallback(!!on)"
              />
            </div>
            <template v-for="item in pools" :key="item.key">
              <v-divider />
              <div class="mi-route">
                <div class="mi-route__text">
                  <div class="text-body-2 font-weight-medium">{{ item.title }}</div>
                  <div class="text-caption text-medium-emphasis">{{ item.hint }}</div>
                </div>
                <v-switch
                  :model-value="item.pool.auto.value"
                  :disabled="poolsLocked"
                  color="primary"
                  density="compact"
                  hide-details
                  inset
                  class="flex-grow-0"
                  @update:model-value="(on) => setPool(item.pool, !!on)"
                />
              </div>
            </template>
          </div>
        </section>

        <section v-if="isWindows" class="mi-section mt-8">
          <div class="mi-section__head">
            <span class="text-subtitle-2">{{ mi("virtualAdapterTitle") }}</span>
            <HelpTip :text="mi('virtualAdapterDescription')" />
          </div>
          <div class="capture-modes" role="radiogroup" :aria-label="mi('virtualAdapterTitle')">
            <div
              v-for="mode in captureModes"
              :key="String(mode.virtual)"
              class="capture-mode"
              :class="{
                'capture-mode--active': virtualOn === mode.virtual,
                'capture-mode--busy': virtualAdapterBusy,
              }"
              role="radio"
              :aria-checked="virtualOn === mode.virtual"
              :tabindex="virtualAdapterBusy ? -1 : 0"
              @click="toggleVirtualAdapter(mode.virtual)"
              @keydown.space.prevent="toggleVirtualAdapter(mode.virtual)"
            >
              <v-progress-linear
                v-if="virtualAdapterBusy && virtualOn !== mode.virtual"
                indeterminate
                color="primary"
                height="2"
                absolute
              />
              <div class="capture-mode__head">
                <div class="capture-mode__icon">
                  <v-icon :icon="mode.icon" size="22" />
                </div>
                <div class="capture-mode__title">
                  <div class="d-flex align-center flex-wrap ga-2">
                    <span class="text-subtitle-2">{{ mode.title }}</span>
                    <v-chip v-if="mode.badge" size="x-small" color="primary" variant="tonal">
                      {{ mode.badge }}
                    </v-chip>
                  </div>
                  <div class="text-caption text-medium-emphasis">{{ mode.summary }}</div>
                </div>
                <span class="capture-mode__radio" />
              </div>
              <ul class="capture-mode__list">
                <li v-for="pro in mode.pros" :key="pro">
                  <v-icon icon="mdi-check-circle" size="16" color="success" />
                  <span>{{ pro }}</span>
                </li>
                <li v-for="con in mode.cons" :key="con" class="capture-mode__con">
                  <v-icon icon="mdi-minus-circle" size="16" color="error" />
                  <span>{{ con }}</span>
                </li>
              </ul>
            </div>
          </div>
          <v-alert
            v-if="virtualAdapterError"
            type="error"
            variant="tonal"
            density="compact"
            class="mt-3"
            :text="virtualAdapterError"
          />
        </section>
      </div>
    </Container>
  </div>
</template>

<style scoped>
.multi-internet {
  max-width: 1100px;
}

.mi-section__head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}

/* Use every adapter: one tile per pool; the whole tile toggles. */

/* Routes per adapter: a row per transport with a stepper. */
.mi-routes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 14px 32px;
}

.mi-route {
  display: flex;
  align-items: center;
  gap: 16px;
}

.mi-route__text {
  flex: 1 1 auto;
  min-width: 0;
}

.mi-stepper {
  display: inline-flex;
  align-items: center;
  flex: none;
  padding: 2px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.mi-stepper--disabled {
  opacity: 0.6;
}

.mi-stepper__value {
  min-width: 32px;
  text-align: center;
  font-size: 1rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

/* Adapter switching: two radio cards. */
.capture-mode:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.capture-mode__icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.7);
  transition: background-color 0.15s, color 0.15s;
}

.capture-mode--active .capture-mode__icon {
  background: rgba(var(--v-theme-primary), 0.15);
  color: rgb(var(--v-theme-primary));
}

.capture-modes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: 12px;
}

.capture-mode {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border: thin solid rgba(var(--v-theme-on-surface), 0.1);
  border-radius: 12px;
  background: rgba(var(--v-theme-surface), 0.45);
  cursor: pointer;
  user-select: none;
  transition: border-color 0.15s, background-color 0.15s;
}

.capture-mode:hover {
  border-color: rgba(var(--v-theme-on-surface), 0.25);
}

.capture-mode--active {
  border-color: rgba(var(--v-theme-primary), 0.6);
  background: rgba(var(--v-theme-primary), 0.06);
}

.capture-mode--busy {
  cursor: progress;
}

.capture-mode__head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.capture-mode__title {
  flex: 1 1 auto;
  min-width: 0;
}

/* The radio: a ring, with a dot when picked. */
.capture-mode__radio {
  flex: none;
  width: 20px;
  height: 20px;
  margin-top: 2px;
  border-radius: 50%;
  border: 2px solid rgba(var(--v-theme-on-surface), 0.35);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.capture-mode--active .capture-mode__radio {
  border-color: rgb(var(--v-theme-primary));
  box-shadow:
    inset 0 0 0 3px rgb(var(--v-theme-surface)),
    inset 0 0 0 10px rgb(var(--v-theme-primary));
}

.capture-mode__list {
  list-style: none;
  padding: 12px 0 0;
  margin: 0;
  display: grid;
  gap: 8px;
  border-top: thin solid rgba(var(--v-theme-on-surface), 0.08);
}

.capture-mode__list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.capture-mode__con {
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.capture-mode__list .v-icon {
  margin-top: 1px;
  flex-shrink: 0;
}

.adapter-slot {
  position: relative;
  border-radius: 8px;
  transition: box-shadow 0.15s;
}

/* The dragged card follows the pointer, above the others. */
.adapter-slot--dragging {
  z-index: 5;
  transition: none;
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.45);
}

.adapter-slot--drop {
  box-shadow: 0 0 0 2px rgb(var(--v-theme-primary));
}

/* Grip at the top centre: a drag handle and the order number. Always
   visible, big enough to grab. */
.adapter-slot__grip {
  position: absolute;
  top: -10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
  padding: 0 10px 0 6px;
  border-radius: 999px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: grab;
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  touch-action: none;
  user-select: none;
  transition: color 0.15s, border-color 0.15s, background-color 0.15s;
}

.adapter-slot:hover .adapter-slot__grip,
.adapter-slot--dragging .adapter-slot__grip {
  color: rgb(var(--v-theme-primary));
  border-color: rgba(var(--v-theme-primary), 0.5);
}

.adapter-slot__grip:active {
  cursor: grabbing;
}

.multi-internet__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
  /* Rows leave room for each card's grip (top) and chevron (bottom). */
  gap: 32px 12px;
  padding-top: 10px;
  padding-bottom: 10px;
}
</style>

<style>
/* While a card is dragged: the grab cursor everywhere, no text selection. */
body.adapter-dragging,
body.adapter-dragging * {
  cursor: grabbing !important;
  user-select: none !important;
}
</style>
