/** The right-click menu every title in the app shares (drawer, apps list,
 * overview): where it opens and for which title, and what the title page
 * should open once it is shown (its Play from picker or settings). */
const state = reactive({ open: false, x: 0, y: 0, titleId: "" });
const pending = reactive<{ titleId: string; what: "location" | "settings" | "" }>({ titleId: "", what: "" });
/** One profile's popup to open on its title page: its route settings or its
 * download cap (from Bandwidth Control's "Through LagZap"). */
type ProfilePopup = "settings" | "cap";
const pendingProfile = reactive<{ profileId: string; what: ProfilePopup | "" }>({ profileId: "", what: "" });

export function useTitleMenu() {
  function openAt(event: MouseEvent, titleId: string) {
    event.preventDefault();
    event.stopPropagation();
    state.x = event.clientX;
    state.y = event.clientY;
    state.titleId = titleId;
    state.open = true;
  }

  /** Asks the title page to open this once it is shown. */
  function request(titleId: string, what: "location" | "settings") {
    pending.titleId = titleId;
    pending.what = what;
  }

  /** The page takes a request for its title (once). */
  function take(titleId: string, what: "location" | "settings") {
    if (pending.titleId !== titleId || pending.what !== what) return false;
    pending.titleId = "";
    pending.what = "";
    return true;
  }

  function requestProfile(profileId: string, what: ProfilePopup) {
    pendingProfile.profileId = profileId;
    pendingProfile.what = what;
  }

  /** The profile's card takes a request for it (once). */
  function takeProfile(profileId: string, what: ProfilePopup) {
    if (pendingProfile.profileId !== profileId || pendingProfile.what !== what) return false;
    pendingProfile.profileId = "";
    pendingProfile.what = "";
    return true;
  }

  return { state, pending, pendingProfile, openAt, request, take, requestProfile, takeProfile };
}
