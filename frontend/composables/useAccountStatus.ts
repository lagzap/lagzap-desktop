import { useLocale } from "vuetify";
import { useAccountPlan } from "~/composables/useAccountPlan";

export type ServiceTone = "ok" | "warn" | "busy" | "off";

export type PlanStatus =
  | "active"
  | "trial"
  | "admin"
  | "expiring"
  | "expired"
  | "none"
  | "loading"
  | "unavailable";

/** Account / service / plan display for Overview + drawer. */
export function useAccountStatus() {
  const store = useStore();
  const data = useSanctumUser<DataResponse>();
  const { t } = useLocale();
  const plan = useAccountPlan();

  const user = computed(() => data.value?.user ?? null);

  const displayName = computed(
    () =>
      // Never the email: it is personal (streamers keep the app on screen).
      user.value?.name?.trim() ||
      t("$vuetify.status.player1")
  );

  const planName = computed(() => {
    const name = plan.name.value || t(`$vuetify.profile.status.${plan.status.value}`);
    const access = plan.access.value;
    if (access?.source !== "team") return name;
    return access.team_role !== "owner" && access.team_owner
      ? `${name} · ${t("$vuetify.team.badgeVia", access.team_owner)}`
      : `${name} · ${t("$vuetify.team.badge")}`;
  });

  /** An active plan ending within a week reads as expiring. */
  const planStatus = computed<PlanStatus>(() => {
    const status = plan.status.value as PlanStatus;
    if (status === "active" && plan.daysLeft.value != null && plan.daysLeft.value <= 7) {
      return "expiring";
    }
    return status;
  });

  const expiresAt = computed(() => plan.access.value?.expires_at || null);

  const planStatusLabel = computed(() => {
    switch (planStatus.value) {
      case "expiring":
        return t("$vuetify.accountStatus.planExpiring");
      default:
        return t(`$vuetify.profile.status.${planStatus.value}`);
    }
  });

  const planHint = computed(() => {
    if (!plan.active.value) {
      return planStatus.value === "loading" ? "" : t(`$vuetify.profile.inactive.${planStatus.value}`);
    }
    return plan.expiresText.value
      ? t("$vuetify.accountStatus.expiresOn", [plan.expiresText.value])
      : t("$vuetify.accountStatus.noExpiry");
  });

  const service = computed(() => {
    if (store.optimizing) {
      return {
        tone: "busy" as ServiceTone,
        label: t("$vuetify.accountStatus.serviceOptimizing"),
        hint: t("$vuetify.accountStatus.serviceOptimizingHint"),
      };
    }
    if (!store.serviceReady) {
      return {
        tone: "off" as ServiceTone,
        label: t("$vuetify.status.serviceNotRunning"),
        hint: t("$vuetify.accountStatus.serviceOffHint"),
      };
    }
    if (store.ndisRunning) {
      if (store.internetStatus === "reconnecting") {
        return {
          tone: "warn" as ServiceTone,
          label: t("$vuetify.accountStatus.serviceRouting"),
          hint: t("$vuetify.status.internetReconnecting"),
        };
      }
      if (store.internetStatus === "offline") {
        return {
          tone: "warn" as ServiceTone,
          label: t("$vuetify.accountStatus.serviceRouting"),
          hint: t("$vuetify.status.offline"),
        };
      }
      return {
        tone: "ok" as ServiceTone,
        label: t("$vuetify.accountStatus.serviceRouting"),
        hint: t("$vuetify.accountStatus.serviceRoutingHint"),
      };
    }
    return {
      tone: "warn" as ServiceTone,
      label: t("$vuetify.accountStatus.servicePaused"),
      hint: t("$vuetify.accountStatus.servicePausedHint"),
    };
  });

  return {
    user,
    displayName,
    planName,
    planStatus,
    planStatusLabel,
    planHint,
    expiresAt,
    service,
  };
}
