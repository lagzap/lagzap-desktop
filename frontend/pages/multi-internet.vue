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
// latter reliably, which left the cards impossible to move.
const dragging = ref<string | null>(null);
const dropTarget = ref<string | null>(null);

function slotUnder(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-adapter]");
  return el?.dataset.adapter ?? null;
}

function onGripDown(name: string, event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  dragging.value = name;
  dropTarget.value = null;
  document.body.classList.add("adapter-dragging");
}
function onGripMove(event: PointerEvent) {
  if (!dragging.value) return;
  const over = slotUnder(event.clientX, event.clientY);
  dropTarget.value = over && over !== dragging.value ? over : null;
}
function onGripUp() {
  const from = orderedNames.value.indexOf(dragging.value ?? "");
  const to = orderedNames.value.indexOf(dropTarget.value ?? "");
  if (from >= 0 && to >= 0 && from !== to) {
    const next = [...orderedNames.value];
    next.splice(to, 0, ...next.splice(from, 1));
    commitOrder(next);
  }
  onDragEnd();
}
function onDragEnd() {
  dragging.value = dropTarget.value = null;
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
    pros: [mi("captureStandardPro1"), mi("captureStandardPro2"), mi("captureStandardPro3")],
    cons: [mi("captureStandardCon1")],
  },
  {
    virtual: true,
    icon: "mdi-lan-connect",
    title: mi("captureVirtual"),
    badge: "",
    pros: [mi("captureVirtualPro1"), mi("captureVirtualPro2")],
    cons: [mi("captureVirtualCon1"), mi("captureVirtualCon2"), mi("captureVirtualCon3")],
  },
]);
const virtualOn = computed(() => settings.value.virtualAdapter === true);

const pools = computed(() => [
  {
    key: "multi",
    pool: multiInternet,
    label: t("$vuetify.settings.multiInternetPage.autoMulti"),
  },
  {
    key: "backup",
    pool: backupInterfaces,
    label: t("$vuetify.settings.multiInternetPage.autoBackup"),
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
        <div class="multi-internet__auto mb-4">
          <v-switch
            v-for="item in pools"
            :key="item.key"
            v-model="item.pool.auto.value"
            :disabled="store.planBlocked || planCapsInternets"
            :label="item.label"
            color="primary"
            density="compact"
            hide-details
            inset
          />
          <HelpTip :text="t('$vuetify.settings.useAllAdaptersHint')" />
        </div>

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
              :name="name"
              :monitor="monitorOf(name)"
              :color="colorOf(name)"
              :is-default="name === effectiveDefault"
              :default-pinned="defaultInterfaceOverride === name"
              :in-multi="multiInternet.has(name)"
              :can-leave-multi="multiInternet.canRemove(name)"
              :in-backup="backupInterfaces.has(name)"
              :can-leave-backup="backupInterfaces.canRemove(name)"
              :routes="routesOf(name)"
              :plan-locked="planLocked(index)"
              :unlock-internets="index + 1"
              :route-max="routeMax"
              @set-default="setDefault(name, $event)"
              @set-multi="multiInternet.toggle(name, $event)"
              @set-backup="backupInterfaces.toggle(name, $event)"
              @set-tcp="setInterfaceTcp(name, $event)"
              @set-udp="setInterfaceUdp(name, $event)"
            />
          </div>
        </div>
        <div v-else class="text-body-2 text-medium-emphasis py-6 text-center">
          {{ t("$vuetify.networkLatency.monitor.noInterfaces") }}
        </div>

        <section class="mt-6">
          <div class="text-subtitle-2 mb-3">
            {{ mi("routesTitle") }}
            <HelpTip class="ms-1" :text="mi('routesDescription')" />
          </div>
          <div class="multi-internet__route-inputs">
            <v-number-input
              :model-value="globalTcpRoutes"
              :label="t('$vuetify.settings.multiInternetPage.tcp')"
              :placeholder="String(resolvedGlobalTcp)"
              :min="0"
              :max="routeMax"
              persistent-placeholder
              control-variant="split"
              variant="outlined"
              density="compact"
              hide-details
              clearable
              inset
              :disabled="store.planBlocked"
              @update:model-value="setGlobalTcp"
            />
            <v-number-input
              :model-value="globalUdpRoutes"
              :label="t('$vuetify.settings.multiInternetPage.udp')"
              :placeholder="String(resolvedGlobalUdp)"
              :min="0"
              :max="routeMax"
              persistent-placeholder
              control-variant="split"
              variant="outlined"
              density="compact"
              hide-details
              clearable
              inset
              :disabled="store.planBlocked"
              @update:model-value="setGlobalUdp"
            />
          </div>
          <v-checkbox
            :model-value="settings.relayTransportFallback"
            density="compact"
            hide-details
            class="mt-2"
            @update:model-value="setRelayTransportFallback"
          >
            <template #label>
              {{ t("$vuetify.settings.route.transportFallback") }}
              <HelpTip class="ms-1" :text="t('$vuetify.settings.route.transportFallbackHint')" />
            </template>
          </v-checkbox>
        </section>

        <section v-if="isWindows" class="mt-6">
          <div class="text-subtitle-2 mb-3">
            {{ mi("virtualAdapterTitle") }}
            <HelpTip class="ms-1" :text="mi('virtualAdapterDescription')" />
          </div>
          <div class="capture-modes">
            <v-card
              v-for="mode in captureModes"
              :key="String(mode.virtual)"
              class="capture-mode"
              :class="{ 'capture-mode--active': virtualOn === mode.virtual }"
              variant="outlined"
              rounded="lg"
              :disabled="virtualAdapterBusy"
              :ripple="false"
              @click="toggleVirtualAdapter(mode.virtual)"
            >
              <v-progress-linear
                v-if="virtualAdapterBusy && virtualOn !== mode.virtual"
                indeterminate
                color="primary"
                height="2"
                absolute
              />
              <div class="d-flex align-center ga-2 mb-3">
                <v-icon :icon="mode.icon" size="20" />
                <span class="text-subtitle-2">{{ mode.title }}</span>
                <v-chip v-if="mode.badge" size="x-small" color="primary" variant="tonal" rounded="pill">
                  {{ mode.badge }}
                </v-chip>
                <v-spacer />
                <v-icon
                  class="capture-mode__check"
                  :icon="virtualOn === mode.virtual ? 'mdi-check-circle' : 'mdi-circle-outline'"
                  size="20"
                />
              </div>
              <ul class="capture-mode__list">
                <li v-for="pro in mode.pros" :key="pro">
                  <v-icon icon="mdi-check" size="16" color="success" />
                  <span>{{ pro }}</span>
                </li>
                <li v-for="con in mode.cons" :key="con">
                  <v-icon icon="mdi-close" size="16" color="error" />
                  <span>{{ con }}</span>
                </li>
              </ul>
            </v-card>
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

.multi-internet__auto {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 24px;
}

.capture-modes {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
  max-width: 760px;
}

.capture-mode {
  padding: 14px 16px;
  cursor: pointer;
  border-color: rgb(var(--v-theme-on-surface) / 0.12);
  transition: border-color 0.15s, background-color 0.15s;
}

.capture-mode:hover {
  border-color: rgb(var(--v-theme-on-surface) / 0.3);
}

.capture-mode--active {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary) / 0.06);
}

.capture-mode__check {
  opacity: 0.5;
}

.capture-mode--active .capture-mode__check {
  color: rgb(var(--v-theme-primary));
  opacity: 1;
}

.capture-mode__list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 6px;
}

.capture-mode__list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.capture-mode__list .v-icon {
  margin-top: 1px;
  flex-shrink: 0;
}

.multi-internet__route-inputs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 200px));
  gap: 12px;
}

.adapter-slot {
  position: relative;
  border-radius: 8px;
  transition: opacity 0.15s, box-shadow 0.15s;
}

.adapter-slot--dragging {
  opacity: 0.4;
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
  /* Rows leave room above each card for its grip. */
  gap: 22px 12px;
  padding-top: 10px;
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
