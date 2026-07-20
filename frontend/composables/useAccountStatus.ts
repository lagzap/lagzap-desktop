import { useLocale } from "vuetify";

export type ServiceTone = "ok" | "warn" | "busy" | "off";

export type PlanStatus = "active" | "trial" | "expiring" | "expired" | "unknown";

/**
 * Account / service / plan display for Overview + drawer.
 * Plan fields are stubbed until subscription API exists.
 */
export function useAccountStatus() {
  const store = useStore();
  const data = useSanctumUser<DataResponse>();
  const { t } = useLocale();

  const user = computed(() => data.value?.user ?? null);

  const displayName = computed(
    () =>
      user.value?.name?.trim() ||
      user.value?.email?.trim() ||
      t("$vuetify.status.player1")
  );

  const planName = computed(
    () => user.value?.plan_name?.trim() || t("$vuetify.status.unlimited")
  );

  const planStatus = computed<PlanStatus>(() => {
    const raw = (user.value?.plan_status || "active").toLowerCase();
    if (
      raw === "active" ||
      raw === "trial" ||
      raw === "expiring" ||
      raw === "expired"
    ) {
      return raw;
    }
    return "unknown";
  });

  const expiresAt = computed(() => user.value?.expires_at ?? null);

  const planStatusLabel = computed(() => {
    switch (planStatus.value) {
      case "trial":
        return t("$vuetify.accountStatus.planTrial");
      case "expiring":
        return t("$vuetify.accountStatus.planExpiring");
      case "expired":
        return t("$vuetify.accountStatus.planExpired");
      case "active":
        return t("$vuetify.status.active");
      default:
        return t("$vuetify.accountStatus.planUnknown");
    }
  });

  const planHint = computed(() => {
    if (planStatus.value === "expired") {
      return t("$vuetify.accountStatus.planExpiredHint");
    }
    if (!expiresAt.value) {
      return t("$vuetify.accountStatus.noExpiry");
    }
    try {
      const d = new Date(expiresAt.value);
      if (Number.isNaN(d.getTime())) {
        return t("$vuetify.accountStatus.noExpiry");
      }
      return t("$vuetify.accountStatus.expiresOn", [
        d.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        }),
      ]);
    } catch {
      return t("$vuetify.accountStatus.noExpiry");
    }
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
