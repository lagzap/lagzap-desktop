import { computed } from "vue";
import { useLocale } from "vuetify";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { formatLocale } from "~/utils/localeFormat";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Status → chip color. */
export const PLAN_STATUS_COLOR: Record<string, string> = {
  active: "success",
  free: "grey",
  trial: "info",
  admin: "primary",
  expired: "error",
  none: "error",
  loading: "grey",
  unavailable: "warning",
};

/** The subscription as the coordinator applies it, for the profile page,
 * the overview strip and the drawer. */
export function useAccountPlan() {
  const plan = usePlanAccess();
  const user = useSanctumUser<DataResponse>();
  const subscriber = computed(() => user.value?.user);

  const { t } = useLocale();
  // The free tier has no plan name of its own.
  const name = computed(
    () => plan.access.value?.name || (plan.status.value === "free" ? t("$vuetify.profile.freePlan") : ""),
  );
  const status = plan.status;
  const expiresAt = computed(() => {
    const raw = plan.access.value?.expires_at ?? "";
    const date = raw ? new Date(raw) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  });
  const daysLeft = computed(() => {
    if (!expiresAt.value) return null;
    return Math.max(0, Math.ceil((expiresAt.value.getTime() - Date.now()) / DAY_MS));
  });
  const expiresText = computed(() =>
    expiresAt.value
      ? new Intl.DateTimeFormat(formatLocale.value === "fa" ? "fa-IR" : "en-US", { dateStyle: "medium" }).format(
          expiresAt.value,
        )
      : "",
  );

  return { ...plan, subscriber, name, status, expiresAt, daysLeft, expiresText };
}
