import { computed, ref } from "vue";
import { Browser, Events } from "@wailsio/runtime";
import { GetPlanAccess } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { PlanAccess } from "~/bindings/github.com/lagzap/lagzap/adapter/models";

// What the user's plan makes locked or hidden, and its limits. Go decides it
// (coordinator/plan_access.go) and already leaves hidden titles, profiles and
// servers out of what the UI gets; this shows locks and the unlock offer.

const LOCKED = "locked";
const UNAVAILABLE = "unavailable";

const access = ref<PlanAccess | null>(null);
let listening = false;

async function refresh() {
  try {
    access.value = (await GetPlanAccess()) ?? null;
  } catch {
    // service not running yet: "service-started" refreshes
  }
}

export function usePlanAccess() {
  if (!listening) {
    listening = true;
    Events.On("plan-access", ({ data }) => {
      access.value = (Array.isArray(data) ? data[0] : data) as PlanAccess;
    });
    Events.On("service-started", () => void refresh());
    void refresh();
  }

  /** Games are routed: an active, trial or admin plan. */
  const active = computed(() => access.value?.active ?? false);
  /** active | trial | admin | expired | none | loading | unavailable */
  const status = computed(() => access.value?.status ?? "loading");
  const admin = computed(() => status.value === "admin");
  const limits = computed(() => access.value?.limits);
  const canUpgrade = computed(() => !!access.value?.upgrade_url);

  /** Locked: a plan offers it, so it can be purchased. */
  const titleLocked = (id: string) => access.value?.titles?.[id] === LOCKED;
  const profileLocked = (id: string) => access.value?.profiles?.[id] === LOCKED;
  /** Unavailable: no plan offers it yet; shown, but nothing to purchase. */
  const titleUnavailable = (id: string) => access.value?.titles?.[id] === UNAVAILABLE;
  const profileUnavailable = (id: string) => access.value?.profiles?.[id] === UNAVAILABLE;
  /** Cannot be turned on: locked or unavailable. */
  const titleBlocked = (id: string) => titleLocked(id) || titleUnavailable(id);
  const profileBlocked = (id: string) => profileLocked(id) || profileUnavailable(id);
  const nodeLocked = (id: string) => access.value?.nodes?.[id] === LOCKED;
  /** Admins have every feature. */
  const hasFeature = (feature: string) =>
    admin.value || (access.value?.features ?? []).includes(feature);

  const openUpgrade = () => {
    const url = access.value?.upgrade_url;
    if (url) {
      void Browser.OpenURL(url);
    }
  };

  return {
    access,
    active,
    status,
    admin,
    limits,
    canUpgrade,
    titleLocked,
    profileLocked,
    titleUnavailable,
    profileUnavailable,
    titleBlocked,
    profileBlocked,
    nodeLocked,
    hasFeature,
    openUpgrade,
    refresh,
  };
}
