<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { Events } from "@wailsio/runtime";
import { useLocale } from "vuetify";
import { RateProfileSession, RateSession } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { displayAlert, displayError } from "~/composables/alert";
import { useSessionRating, type ManualRatingRequest } from "~/composables/useSessionRating";

/** Rates a game session. The backend asks after some sessions (long ones,
 * rarely) with "stats-rate-session"; the user can also rate from a profile
 * card (useSessionRating), which rates that profile's running or just-ended
 * session. The rating goes out with the connection statistics. */
interface RatingRequest {
  session_id: string;
  title_id: string;
  profile_id: string;
  duration_ms: number;
}

const REASONS = ["high_ping", "lag_spikes", "disconnects", "slow_download", "great", "other"] as const;

const locale = useLocale();
const { t } = locale;
const store = useStore();

const request = ref<RatingRequest | null>(null);
/** Set when the user opened it from a profile card. */
const manual = ref<ManualRatingRequest | null>(null);
const { manualRequest } = useSessionRating();
const open = ref(false);
const stars = ref(0);
const reasons = ref<string[]>([]);
const comment = ref("");
const sending = ref(false);

const gameName = computed(() => {
  const titleId = manual.value ? manual.value.titleId : request.value?.title_id;
  const title = store.titles.find((item) => item.id === titleId);
  return title ? store.titleName(title.name) || title.id : "";
});

function asRequest(data: unknown): RatingRequest | null {
  const raw = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (!raw || typeof raw !== "object" || !(raw as RatingRequest).session_id) return null;
  return raw as RatingRequest;
}

function reset() {
  stars.value = 0;
  reasons.value = [];
  comment.value = "";
  open.value = true;
}

function ask(next: RatingRequest | null) {
  if (!next || open.value) return;
  request.value = next;
  manual.value = null;
  reset();
}

watch(manualRequest, (next) => {
  if (!next) return;
  manualRequest.value = null;
  if (open.value) return;
  manual.value = next;
  reset();
});

async function send() {
  if ((!request.value && !manual.value) || stars.value < 1 || sending.value) return;
  sending.value = true;
  try {
    const text = comment.value.trim();
    if (manual.value) {
      await RateProfileSession(manual.value.profileId, stars.value, reasons.value, text);
    } else if (request.value) {
      await RateSession(request.value.session_id, stars.value, reasons.value, text);
    }
    displayAlert(t("$vuetify.sessionRating.thanks"), "success");
    open.value = false;
  } catch (error) {
    if (String(error).includes("no session to rate")) {
      displayAlert(t("$vuetify.sessionRating.noSession"), "warning");
      open.value = false;
    } else {
      displayError(error, locale);
    }
  } finally {
    sending.value = false;
  }
}

let off: (() => void) | undefined;
onMounted(() => {
  off = Events.On("stats-rate-session", ({ data }: any) => ask(asRequest(data)));
});
onUnmounted(() => off?.());
</script>

<template>
  <v-dialog v-model="open" max-width="460" :persistent="sending">
    <v-card :title="gameName ? t('$vuetify.sessionRating.titleGame', [gameName]) : t('$vuetify.sessionRating.title')">
      <v-card-text class="pt-1">
        <div class="text-body-2 text-medium-emphasis mb-3">
          {{ t("$vuetify.sessionRating.subtitle") }}
        </div>
        <div class="d-flex justify-center mb-3">
          <v-rating v-model="stars" length="5" size="36" color="primary" hover density="comfortable" />
        </div>
        <v-chip-group v-model="reasons" multiple column>
          <v-chip
            v-for="reason in REASONS"
            :key="reason"
            :value="reason"
            variant="tonal"
            filter
            size="small"
          >
            {{ t(`$vuetify.sessionRating.reasons.${reason}`) }}
          </v-chip>
        </v-chip-group>
        <v-textarea
          v-model="comment"
          :label="t('$vuetify.sessionRating.comment')"
          variant="outlined"
          density="comfortable"
          rows="2"
          auto-grow
          maxlength="500"
          hide-details
          class="mt-3"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="sending" @click="open = false">
          {{ t("$vuetify.sessionRating.notNow") }}
        </v-btn>
        <v-btn color="primary" :disabled="stars < 1" :loading="sending" @click="send">
          {{ t("$vuetify.sessionRating.send") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
