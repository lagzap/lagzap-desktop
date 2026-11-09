<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLocale } from "vuetify";
import TeamInviteNotes from "~/components/team/TeamInviteNotes.vue";
import { formatTeamDate, useTeam } from "~/composables/useTeam";
import { localDigits } from "~/utils/localeFormat";

/** Pops up each invitation addressed to the user once per run, at startup
 * or the moment one arrives. "Later" keeps it in the Team screen's list
 * until it expires. */
const { t } = useLocale();
const store = useStore();
const router = useRouter();
const { invites, team, active, accept, decline, errorText } = useTeam();

const seen = new Set<string>();
const current = ref<string | null>(null);
const busy = ref<"accept" | "decline" | null>(null);
const error = ref("");

const invite = computed(() => invites.value.find((i) => i.id === current.value) ?? null);
const inTeam = computed(() => !!team.value && active.value);

function next() {
  error.value = "";
  const fresh = invites.value.find((i) => !seen.has(i.id));
  if (fresh) seen.add(fresh.id);
  current.value = fresh?.id ?? null;
}

watch(
  () => [store.appReady, invites.value.map((i) => i.id).join(",")],
  () => {
    if (store.appReady && !current.value) next();
    if (current.value && !invite.value) next(); // withdrawn or expired meanwhile
  },
  { immediate: true },
);

async function respond(kind: "accept" | "decline") {
  if (!invite.value) return;
  busy.value = kind;
  const result = await (kind === "accept" ? accept(invite.value.id) : decline(invite.value.id));
  busy.value = null;
  if (result.error) {
    error.value = errorText(result.error);
    return;
  }
  if (kind === "accept") void router.push({ name: "team" });
  next();
}
</script>

<template>
  <v-dialog :model-value="!!invite" max-width="460" persistent>
    <v-card v-if="invite" rounded="xl" class="pa-2">
      <v-card-title class="d-flex align-center ga-2">
        <v-avatar color="primary" variant="tonal" icon="mdi-account-group-outline" size="36" />
        <span>{{ t("$vuetify.team.invite.title") }}</span>
      </v-card-title>
      <v-card-text class="d-flex flex-column ga-3">
        <div class="text-body-1">
          {{ t("$vuetify.team.invite.text", invite.owner_name, invite.plan_name, localDigits(invite.seats)) }}
        </div>
        <div v-if="invite.expires_at" class="text-caption text-medium-emphasis">
          {{ t("$vuetify.team.invite.expires", formatTeamDate(invite.expires_at)) }}
        </div>
        <TeamInviteNotes />
        <v-alert v-if="error" type="error" variant="tonal" density="compact" :text="error" />
      </v-card-text>
      <v-card-actions class="px-4 pb-3">
        <v-btn variant="text" @click="next">{{ t("$vuetify.team.invite.later") }}</v-btn>
        <v-spacer />
        <v-btn variant="tonal" :loading="busy === 'decline'" :disabled="!!busy" @click="respond('decline')">
          {{ t("$vuetify.team.invite.decline") }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :loading="busy === 'accept'"
          :disabled="!!busy || inTeam"
          @click="respond('accept')"
        >
          {{ t("$vuetify.team.invite.accept") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
