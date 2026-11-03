import { HasRateableSession } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { displayAlert } from "~/composables/alert";

/** Opens the session rating dialog (components/dialog/SessionRating.vue) from
 * a profile card: rates that profile's running or just-ended session. */
export interface ManualRatingRequest {
  profileId: string;
  titleId?: string;
}

const manualRequest = ref<ManualRatingRequest | null>(null);

/** A quick "how is it playing right now" ask for a running session
 * ("stats-rate-live"), shown over that profile's chart. */
export interface LiveRatingRequest {
  session_id: string;
  title_id: string;
  profile_id: string;
  /** When it arrived (ms). */
  at: number;
}

/** Pending live asks by profile id. */
const liveRequests = ref<Record<string, LiveRatingRequest>>({});

export function useSessionRating() {
  return {
    manualRequest,
    liveRequests,
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
