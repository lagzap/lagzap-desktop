<script setup lang="ts">
import { computed, ref } from "vue";
import { useLocale } from "vuetify";
import Container from "~/components/layout/Container.vue";
import SensitiveText from "~/components/common/SensitiveText.vue";
import TeamSeatsBar from "~/components/team/TeamSeatsBar.vue";
import TeamInviteNotes from "~/components/team/TeamInviteNotes.vue";
import { formatTeamDate, useTeam } from "~/composables/useTeam";
import { localDigits } from "~/utils/localeFormat";

/** The team: seats, members and invites for the owner; the team and Leave
 * for members; invitations and joining with a code for everyone. Email,
 * phone and invite codes stay blurred: streamers keep the app on screen. */
const { t } = useLocale();
const tm = useTeam();
const { team, invites, myId, isOwner, active, pendingSeats, nextUnlock, lockUntil } = tm;

const members = computed(() => {
  const list = team.value?.members ?? [];
  const owner = team.value?.owner;
  const rest = list.filter((m) => m.id !== owner?.id);
  return owner ? [{ ...owner, role: "owner", joined_at: "" }, ...rest] : rest;
});
const inActiveTeam = computed(() => !!team.value && active.value);

/* ----- Invite (owner) ----- */
const inviteMode = ref<"email" | "phone" | "code">("email");
const inviteEmail = ref("");
const invitePhone = ref("");
const inviteBusy = ref(false);
const inviteError = ref("");
const offerCode = ref(false);
const newCode = ref("");
const codeOpen = ref(false);
const copied = ref(false);

const canInvite = computed(() => !!team.value && active.value && (team.value.free ?? 0) > 0);
const inviteBlockedText = computed(() => {
  if (!team.value || canInvite.value) return "";
  if (!active.value) return t("$vuetify.team.invite.inactive");
  return nextUnlock.value
    ? t("$vuetify.team.invite.noSeatUntil", formatTeamDate(nextUnlock.value))
    : t("$vuetify.team.invite.noSeat");
});

async function sendInvite() {
  inviteBusy.value = true;
  inviteError.value = "";
  offerCode.value = false;
  const result =
    inviteMode.value === "email"
      ? await tm.inviteByEmail(inviteEmail.value)
      : inviteMode.value === "phone"
        ? await tm.inviteByPhone(invitePhone.value.replace(/\D/g, ""))
        : await tm.createCode();
  inviteBusy.value = false;
  if (result.error) {
    inviteError.value = tm.errorText(result.error);
    offerCode.value = result.error.message === "account_not_found";
    return;
  }
  inviteEmail.value = invitePhone.value = "";
  if (result.code) {
    newCode.value = result.code;
    copied.value = false;
    codeOpen.value = true;
  }
}

async function sendCodeInstead() {
  inviteMode.value = "code";
  await sendInvite();
}

const shareText = computed(() => t("$vuetify.team.code.shareText", newCode.value));
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    copied.value = true;
  } catch {
    // clipboard refused
  }
}
async function share() {
  if (navigator.share) {
    try {
      await navigator.share({ text: shareText.value });
      return;
    } catch {
      // cancelled or not supported: copy instead
    }
  }
  await copy(shareText.value);
}

/* ----- Row actions ----- */
const rowBusy = ref<string | null>(null);
const rowError = ref("");
async function act(id: string, action: () => Promise<{ error?: any }>) {
  rowBusy.value = id;
  rowError.value = "";
  const result = await action();
  rowBusy.value = null;
  if (result.error) rowError.value = tm.errorText(result.error);
}

const removing = ref<{ id: string; name: string } | null>(null);
async function confirmRemove() {
  const member = removing.value;
  removing.value = null;
  if (member) await act(member.id, () => tm.remove(member.id));
}

const leaving = ref(false);
async function confirmLeave() {
  leaving.value = false;
  await act("leave", () => tm.leave());
}

/* ----- Join with code ----- */
const joinCode = ref("");
const joinBusy = ref(false);
const joinError = ref("");
async function joinWithCode() {
  joinBusy.value = true;
  joinError.value = "";
  const result = await tm.join(joinCode.value);
  joinBusy.value = false;
  if (result.error) {
    joinError.value = tm.errorText(result.error);
    return;
  }
  joinCode.value = "";
}
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">{{ t("$vuetify.team.title") }}</v-app-bar-title>
      </template>

      <div class="team-page">
        <v-alert v-if="rowError" type="error" variant="tonal" density="compact" closable :text="rowError" @click:close="rowError = ''" />

        <!-- The team -->
        <section v-if="team" class="lz-panel">
          <div class="lz-panel__head">
            <v-icon icon="mdi-account-group-outline" size="20" color="primary" />
            <span class="text-subtitle-1 font-weight-medium">{{ team.plan?.name }}</span>
            <v-chip size="small" variant="tonal" color="primary">{{ t("$vuetify.team.badge") }}</v-chip>
            <v-spacer />
            <v-chip size="small" variant="tonal" :color="active ? (team.in_use ? 'success' : 'info') : 'grey'">
              {{ active ? (team.in_use ? t("$vuetify.team.status.inUse") : t("$vuetify.team.status.notInUse")) : t("$vuetify.team.status.inactive") }}
            </v-chip>
          </div>

          <div class="text-body-2 text-medium-emphasis">
            {{ isOwner ? t("$vuetify.team.youOwn") : t("$vuetify.team.ownedBy", team.owner?.name) }}
            <template v-if="team.ends_at"> · {{ t("$vuetify.team.endsOn", formatTeamDate(team.ends_at)) }}</template>
          </div>

          <v-alert v-if="!active" type="info" variant="tonal" density="compact" :text="t('$vuetify.team.inactiveNote')" />
          <v-alert v-else-if="!team.in_use" type="info" variant="tonal" density="compact" :text="t('$vuetify.team.notInUseNote')" />

          <TeamSeatsBar
            :seats="team.seats"
            :used="team.used"
            :pending="pendingSeats"
            :locked="team.locked_seats?.length ?? 0"
            :free="team.free"
          />
        </section>

        <!-- Members -->
        <section v-if="team" class="lz-panel">
          <div class="lz-panel__head">
            <v-icon icon="mdi-account-multiple-outline" size="20" color="primary" />
            <span class="text-subtitle-1 font-weight-medium">{{ t("$vuetify.team.members") }}</span>
          </div>
          <div v-for="member in members" :key="member.id" class="team-row">
            <v-avatar size="32" color="primary" variant="tonal">
              <span class="text-caption font-weight-bold">{{ (member.name || "?").slice(0, 2).toUpperCase() }}</span>
            </v-avatar>
            <div class="min-w-0 flex-grow-1">
              <div class="text-body-1 text-truncate">
                {{ member.name || t("$vuetify.status.player1") }}
                <span v-if="member.id === myId" class="text-medium-emphasis">{{ t("$vuetify.team.you") }}</span>
              </div>
              <div v-if="member.joined_at" class="text-caption text-medium-emphasis">
                {{ t("$vuetify.team.joinedOn", formatTeamDate(member.joined_at)) }}
              </div>
            </div>
            <v-chip size="x-small" variant="tonal" :color="member.role === 'owner' ? 'amber' : undefined">
              {{ t(`$vuetify.team.role.${member.role || "member"}`) }}
            </v-chip>
            <v-btn
              v-if="isOwner && member.role !== 'owner' && member.id !== myId"
              icon="mdi-account-remove-outline"
              variant="text"
              size="small"
              color="error"
              :loading="rowBusy === member.id"
              :aria-label="t('$vuetify.team.remove.button')"
              @click="removing = { id: member.id, name: member.name }"
            />
          </div>

          <!-- Seats locked after someone left or was removed -->
          <div v-for="(seat, i) in team.locked_seats ?? []" :key="`locked-${i}`" class="team-row">
            <v-avatar size="32" color="warning" variant="tonal" icon="mdi-timer-lock-outline" />
            <div class="flex-grow-1 text-body-2">{{ t("$vuetify.team.seatUnlocksOn", formatTeamDate(seat.unlocks_at)) }}</div>
          </div>

          <div v-if="!isOwner && active" class="d-flex mt-1">
            <v-btn variant="tonal" color="error" rounded="lg" prepend-icon="mdi-logout" :loading="rowBusy === 'leave'" @click="leaving = true">
              {{ t("$vuetify.team.leave.button") }}
            </v-btn>
          </div>
        </section>

        <!-- Owner: pending invites and inviting -->
        <section v-if="team && isOwner" class="lz-panel">
          <div class="lz-panel__head">
            <v-icon icon="mdi-email-fast-outline" size="20" color="primary" />
            <span class="text-subtitle-1 font-weight-medium">{{ t("$vuetify.team.invite.heading") }}</span>
          </div>

          <div v-for="pending in team.pending_invites ?? []" :key="pending.id" class="team-row">
            <v-avatar size="32" color="info" variant="tonal" :icon="pending.kind === 'code' ? 'mdi-ticket-confirmation-outline' : 'mdi-account-clock-outline'" />
            <div class="min-w-0 flex-grow-1">
              <div class="text-body-1 text-truncate">
                {{ pending.kind === "code" ? t("$vuetify.team.invite.codeInvite") : pending.invitee_name || t("$vuetify.team.invite.accountInvite") }}
              </div>
              <div class="text-caption text-medium-emphasis">{{ t("$vuetify.team.invite.expires", formatTeamDate(pending.expires_at)) }}</div>
            </div>
            <v-btn variant="text" size="small" color="error" :loading="rowBusy === pending.id" @click="act(pending.id, () => tm.revoke(pending.id))">
              {{ t("$vuetify.team.invite.revoke") }}
            </v-btn>
          </div>

          <v-alert v-if="inviteBlockedText" type="info" variant="tonal" density="compact" :text="inviteBlockedText" />
          <template v-else>
            <v-btn-toggle v-model="inviteMode" mandatory density="compact" variant="outlined" divided rounded="lg">
              <v-btn value="email" prepend-icon="mdi-email-outline" size="small">{{ t("$vuetify.team.invite.byEmail") }}</v-btn>
              <v-btn value="phone" prepend-icon="mdi-phone-outline" size="small">{{ t("$vuetify.team.invite.byPhone") }}</v-btn>
              <v-btn value="code" prepend-icon="mdi-ticket-confirmation-outline" size="small">{{ t("$vuetify.team.invite.byCode") }}</v-btn>
            </v-btn-toggle>
            <div class="d-flex flex-wrap align-start ga-2">
              <v-text-field
                v-if="inviteMode === 'email'"
                v-model="inviteEmail"
                type="email"
                :label="t('$vuetify.profile.email')"
                variant="outlined"
                density="compact"
                hide-details="auto"
                class="team-field lz-sensitive-field"
                @keydown.enter="sendInvite"
              />
              <v-text-field
                v-else-if="inviteMode === 'phone'"
                v-model="invitePhone"
                inputmode="tel"
                :label="t('$vuetify.profile.phone')"
                :hint="t('$vuetify.team.invite.phoneHint')"
                persistent-hint
                variant="outlined"
                density="compact"
                class="team-field lz-sensitive-field"
                @keydown.enter="sendInvite"
              />
              <span v-else class="text-body-2 text-medium-emphasis team-field">{{ t("$vuetify.team.invite.codeHint") }}</span>
              <v-btn
                variant="tonal"
                color="primary"
                rounded="lg"
                :loading="inviteBusy"
                :disabled="(inviteMode === 'email' && !inviteEmail.trim()) || (inviteMode === 'phone' && !invitePhone.trim())"
                @click="sendInvite"
              >
                {{ inviteMode === "code" ? t("$vuetify.team.invite.createCode") : t("$vuetify.team.invite.send") }}
              </v-btn>
            </div>
            <v-alert v-if="inviteError" type="error" variant="tonal" density="compact" :text="inviteError">
              <template v-if="offerCode" #append>
                <v-btn size="small" variant="tonal" @click="sendCodeInstead">{{ t("$vuetify.team.invite.codeInstead") }}</v-btn>
              </template>
            </v-alert>
          </template>
        </section>

        <!-- Invitations to me -->
        <section v-if="invites.length" class="lz-panel">
          <div class="lz-panel__head">
            <v-icon icon="mdi-email-open-outline" size="20" color="primary" />
            <span class="text-subtitle-1 font-weight-medium">{{ t("$vuetify.team.invitations") }}</span>
          </div>
          <TeamInviteNotes />
          <div v-for="invite in invites" :key="invite.id" class="team-row">
            <v-avatar size="32" color="primary" variant="tonal" icon="mdi-account-group-outline" />
            <div class="min-w-0 flex-grow-1">
              <div class="text-body-1">{{ t("$vuetify.team.invite.text", invite.owner_name, invite.plan_name, localDigits(invite.seats)) }}</div>
              <div class="text-caption text-medium-emphasis">{{ t("$vuetify.team.invite.expires", formatTeamDate(invite.expires_at)) }}</div>
            </div>
            <v-btn variant="text" size="small" :loading="rowBusy === `d-${invite.id}`" @click="act(`d-${invite.id}`, () => tm.decline(invite.id))">
              {{ t("$vuetify.team.invite.decline") }}
            </v-btn>
            <v-btn
              variant="tonal"
              size="small"
              color="primary"
              :disabled="inActiveTeam"
              :loading="rowBusy === `a-${invite.id}`"
              @click="act(`a-${invite.id}`, () => tm.accept(invite.id))"
            >
              {{ t("$vuetify.team.invite.accept") }}
            </v-btn>
          </div>
        </section>

        <!-- Not in a team -->
        <section v-if="!team && !invites.length" class="lz-panel align-center text-center py-8">
          <v-avatar color="primary" variant="tonal" icon="mdi-account-group-outline" size="56" />
          <div class="text-subtitle-1 font-weight-medium">{{ t("$vuetify.team.none") }}</div>
          <div class="text-body-2 text-medium-emphasis">{{ t("$vuetify.team.noneHint") }}</div>
        </section>

        <!-- Join with a code -->
        <section class="lz-panel">
          <div class="lz-panel__head">
            <v-icon icon="mdi-ticket-confirmation-outline" size="20" color="primary" />
            <span class="text-subtitle-1 font-weight-medium">{{ t("$vuetify.team.join.heading") }}</span>
          </div>
          <div class="d-flex flex-wrap align-start ga-2">
            <v-text-field
              v-model="joinCode"
              :label="t('$vuetify.team.join.label')"
              placeholder="ABCD-EFGH"
              variant="outlined"
              density="compact"
              :error-messages="joinError"
              class="team-field lz-sensitive-field"
              @keydown.enter="joinWithCode"
            />
            <v-btn variant="tonal" color="primary" rounded="lg" :loading="joinBusy" :disabled="!joinCode.trim()" @click="joinWithCode">
              {{ t("$vuetify.team.join.button") }}
            </v-btn>
          </div>
        </section>
      </div>
    </Container>

    <!-- Remove a member -->
    <v-dialog :model-value="!!removing" max-width="460" @update:model-value="(o: boolean) => !o && (removing = null)">
      <v-card rounded="xl" class="pa-2">
        <v-card-title>{{ t("$vuetify.team.remove.title", removing?.name) }}</v-card-title>
        <v-card-text>{{ t("$vuetify.team.remove.warning", localDigits(team?.cooldown_days ?? 30), formatTeamDate(lockUntil)) }}</v-card-text>
        <v-card-actions class="px-4 pb-3">
          <v-spacer />
          <v-btn variant="text" @click="removing = null">{{ t("$vuetify.team.cancel") }}</v-btn>
          <v-btn variant="tonal" color="error" @click="confirmRemove">{{ t("$vuetify.team.remove.button") }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Leave the team -->
    <v-dialog v-model="leaving" max-width="460">
      <v-card rounded="xl" class="pa-2">
        <v-card-title>{{ t("$vuetify.team.leave.title", team?.owner?.name) }}</v-card-title>
        <v-card-text>{{ t("$vuetify.team.leave.warning", localDigits(team?.cooldown_days ?? 30)) }}</v-card-text>
        <v-card-actions class="px-4 pb-3">
          <v-spacer />
          <v-btn variant="text" @click="leaving = false">{{ t("$vuetify.team.cancel") }}</v-btn>
          <v-btn variant="tonal" color="error" @click="confirmLeave">{{ t("$vuetify.team.leave.button") }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- A new invite code, shown once -->
    <v-dialog v-model="codeOpen" max-width="440">
      <v-card rounded="xl" class="pa-2">
        <v-card-title>{{ t("$vuetify.team.code.title") }}</v-card-title>
        <v-card-text class="d-flex flex-column ga-3">
          <div class="text-h5 font-weight-bold text-center team-code">
            <SensitiveText :text="newCode" />
          </div>
          <div class="text-caption text-medium-emphasis">{{ t("$vuetify.team.code.note") }}</div>
        </v-card-text>
        <v-card-actions class="px-4 pb-3">
          <v-btn variant="tonal" :prepend-icon="copied ? 'mdi-check' : 'mdi-content-copy'" @click="copy(newCode)">
            {{ copied ? t("$vuetify.profile.copied") : t("$vuetify.team.code.copy") }}
          </v-btn>
          <v-btn variant="tonal" prepend-icon="mdi-share-variant-outline" @click="share">{{ t("$vuetify.team.code.share") }}</v-btn>
          <v-spacer />
          <v-btn variant="text" @click="codeOpen = false">{{ t("$vuetify.team.code.done") }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.team-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  max-width: 900px;
}

.team-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.team-field {
  flex: 1 1 260px;
  min-width: 0;
}

.team-code {
  font-family: monospace;
  letter-spacing: 0.1em;
}
</style>
