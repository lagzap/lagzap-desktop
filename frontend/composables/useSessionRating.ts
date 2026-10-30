import { HasRateableSession } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { displayAlert } from "~/composables/alert";

/** Opens the session rating dialog (components/dialog/SessionRating.vue) from
 * a profile card: rates that profile's running or just-ended session. */
export interface ManualRatingRequest {
  profileId: string;
  titleId?: string;
}

const manualRequest = ref<ManualRatingRequest | null>(null);

export function useSessionRating() {
  return {
    manualRequest,
    /** Opens the dialog, or says there is nothing to rate yet. */
    rateProfile: async (profileId: string, titleId: string | undefined, noSessionText: string) => {
      if (!(await HasRateableSession(profileId).catch(() => false))) {
        displayAlert(noSessionText, "warning");
        return;
      }
      manualRequest.value = { profileId, titleId };
    },
  };
}
