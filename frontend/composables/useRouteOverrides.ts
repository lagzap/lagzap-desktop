import { useLocale } from "vuetify";
import { useStore } from "@/stores";
import type { Profile, ProfileState, TitleState } from "~/bindings/github.com/lagzap/zap/data";
import { ProfileFlag } from "~/constants/profile";
import { profileLimit } from "~/composables/useBandwidthControl";
import { hasGroup } from "~/utils/profileRoute";

export type OverrideKind = "internets" | "routes" | "domestic" | "fallback" | "transport" | "cap";

/** What a state sets of its own in Route Settings: its internets, route
 * counts, domestic paths, transport fallback, protocol. An empty internet
 * ("", no list, or "*" — the Multi Internet page's pool) follows. */
export function stateOverrideKinds(st: Partial<ProfileState> | Partial<TitleState> | null | undefined): OverrideKind[] {
  if (!st) return [];
  const s = st as Partial<ProfileState>;
  const out: OverrideKind[] = [];
  if (!!s.default_interface || (s.network_interfaces ?? []).some((n) => n && n !== "*")) out.push("internets");
  if (hasGroup(st, "routes")) out.push("routes");
  if (hasGroup(st, "domestic")) out.push("domestic");
  if (hasGroup(st, "fallback")) out.push("fallback");
  if (hasGroup(st, "transport")) out.push("transport");
  return out;
}

/** Whether a profile's Route Settings differ from the global ones: what the
 * Settings button and each profile's chip mark with a dot. */
export function useRouteOverrides() {
  const store = useStore();
  const { t } = useLocale();
  /** What the profile sets of its own. titleBacked: the game's main
   * profile, whose settings are the title's. */
  function profileOverrideKinds(profile: Profile, titleBacked: boolean): OverrideKind[] {
    const st = titleBacked ? store.titleStates[profile.title_id ?? ""] : store.ownProfileStates[profile.id];
    const out = stateOverrideKinds(st as Partial<ProfileState> | undefined);
    const flags = profile.flags ?? 0;
    const highTraffic =
      (flags & ProfileFlag.HIGH_TRAFFIC) !== 0 &&
      (flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET | ProfileFlag.PREVENT_DISCONNECT)) === 0;
    if (highTraffic && profileLimit(profile.id) !== null) out.push("cap");
    return out;
  }
  function profileOverrides(profile: Profile, titleBacked: boolean): boolean {
    return profileOverrideKinds(profile, titleBacked).length > 0;
  }
  /** "Set for this app: Internets, Routes": what the dot's tooltip says. */
  function overridesText(kinds: OverrideKind[]): string {
    const names = [...new Set(kinds)].map((k) => t(`$vuetify.title.profile.override.${k}`));
    return t("$vuetify.title.profile.override.setHere", names.join(", "));
  }
  return { profileOverrides, profileOverrideKinds, overridesText };
}
