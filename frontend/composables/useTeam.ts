import { computed, ref, watch } from "vue";
import { Events } from "@wailsio/runtime";
import { useLocale } from "vuetify";
import {
  AcceptTeamInvite,
  CreateTeamInviteCode,
  DeclineTeamInvite,
  InviteToTeam,
  JoinTeam,
  LeaveTeam,
  RemoveTeamMember,
  RevokeTeamInvite,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { Team, TeamError, TeamInvite, TeamResult } from "~/bindings/github.com/lagzap/lagzap/adapter/models";
import { formatLocale } from "~/utils/localeFormat";

// The user's team and the invitations addressed to them. They come with the
// account (GET /data, refreshed on every account update), and every team
// action's reply updates them at once.

const team = ref<Team | null>(null);
const invites = ref<TeamInvite[]>([]);
let listening = false;

function applyResult(result: TeamResult | null | undefined) {
  if (!result || result.error) return;
  team.value = result.team ?? null;
  invites.value = result.team_invites ?? [];
}

export function formatTeamDate(raw: string | Date | null | undefined): string {
  const date = raw instanceof Date ? raw : raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(formatLocale.value === "fa" ? "fa-IR" : "en-US", { dateStyle: "medium" }).format(date);
}

export function useTeam() {
  const { t } = useLocale();
  const user = useSanctumUser<DataResponse>();

  if (!listening) {
    listening = true;
    watch(
      () => user.value,
      (data) => {
        team.value = data?.team ?? null;
        invites.value = data?.team_invites ?? [];
      },
      { immediate: true, deep: true },
    );
    Events.On("team", ({ data }) => applyResult((Array.isArray(data) ? data[0] : data) as TeamResult));
  }

  const myId = computed(() => user.value?.user?.id ?? "");
  const isOwner = computed(() => team.value?.role === "owner");
  const active = computed(() => team.value?.active === true);

  /** Seats taken by invites nobody accepted yet (the owner sees the list;
   * members get the count from what is left over). */
  const pendingSeats = computed(() => {
    const tm = team.value;
    if (!tm) return 0;
    if (tm.pending_invites?.length) return tm.pending_invites.length;
    return Math.max(0, tm.seats - tm.used - (tm.locked_seats?.length ?? 0) - tm.free);
  });

  /** When the next locked seat opens, if any. */
  const nextUnlock = computed(() => {
    const dates = (team.value?.locked_seats ?? [])
      .map((seat) => new Date(seat.unlocks_at))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    return dates[0] ?? null;
  });

  /** Until when a seat freed now stays locked: the cooldown, or the plan
   * period's end when that comes first. */
  const lockUntil = computed(() => {
    const tm = team.value;
    const days = tm?.cooldown_days ?? 30;
    const cooldown = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const ends = tm?.ends_at ? new Date(tm.ends_at) : null;
    return ends && !Number.isNaN(ends.getTime()) && ends < cooldown ? ends : cooldown;
  });

  /** A refusal in the user's language. */
  const errorText = (error: TeamError | null | undefined): string => {
    if (!error) return "";
    const key = error.message || error.code;
    if (key === "seat_locked" && error.unlocks_at) {
      return t("$vuetify.team.errors.seatLockedUntil", formatTeamDate(error.unlocks_at));
    }
    const translated = t(`$vuetify.team.errors.${key}`);
    return translated === `$vuetify.team.errors.${key}` ? t("$vuetify.team.errors.unknown") : translated;
  };

  /** Runs an action and keeps the team in step with its reply. */
  const run = async (action: () => Promise<TeamResult>): Promise<TeamResult> => {
    let result: TeamResult;
    try {
      result = await action();
    } catch {
      result = { team: null, team_invites: [], code: "", error: { code: "unreachable", message: "unreachable", unlocks_at: "" } } as TeamResult;
    }
    applyResult(result);
    return result;
  };

  return {
    team,
    invites,
    myId,
    isOwner,
    active,
    pendingSeats,
    nextUnlock,
    lockUntil,
    errorText,
    inviteByEmail: (email: string) => run(() => InviteToTeam(email, "")),
    inviteByPhone: (phone: string) => run(() => InviteToTeam("", phone)),
    createCode: () => run(() => CreateTeamInviteCode()),
    revoke: (id: string) => run(() => RevokeTeamInvite(id)),
    accept: (id: string) => run(() => AcceptTeamInvite(id)),
    decline: (id: string) => run(() => DeclineTeamInvite(id)),
    join: (code: string) => run(() => JoinTeam(code)),
    remove: (memberId: string) => run(() => RemoveTeamMember(memberId)),
    leave: () => run(() => LeaveTeam()),
  };
}
