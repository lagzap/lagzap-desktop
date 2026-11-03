<script setup lang="ts">
import { useLocale } from "vuetify";
import { RateSession } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { displayError } from "~/composables/alert";
import { useSessionRating } from "~/composables/useSessionRating";

/** A quick rating of how a running session plays right now, over the
 * profile's chart. Go asks now and then ("stats-rate-live"): ten minutes into
 * a session, at different hours of the day. One tap sends it. */
const props = defineProps<{ profileId: string }>();

// An ask nobody answered goes away on its own.
const LIVE_ASK_TTL_MS = 20 * 60_000;
const THANKS_MS = 1800;

const locale = useLocale();
const { t } = locale;
const store = useStore();
const { liveRequests } = useSessionRating();

const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 60_000);
});
onBeforeUnmount(() => clearInterval(clock));
const request = computed(() => {
  const req = liveRequests.value[props.profileId];
  return req && Math.max(now.value, req.at) - req.at < LIVE_ASK_TTL_MS ? req : null;
});

const stars = ref(0);
const sending = ref(false);
const thanked = ref(false);

const title = computed(() => {
  const game = store.titles.find((item) => item.id === request.value?.title_id);
  const name = game ? store.titleName(game.name) : "";
  return name ? t("$vuetify.sessionRating.liveTitle", [name]) : t("$vuetify.sessionRating.liveTitleGeneric");
});

function dismiss() {
  const next = { ...liveRequests.value };
  delete next[props.profileId];
  liveRequests.value = next;
  stars.value = 0;
  thanked.value = false;
}

async function rate(value: number | string) {
  const req = request.value;
  if (!req || sending.value || thanked.value) return;
  stars.value = Number(value);
  sending.value = true;
  try {
    await RateSession(req.session_id, stars.value, [], "");
    thanked.value = true;
    setTimeout(dismiss, THANKS_MS);
  } catch (error) {
    displayError(error, locale);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <v-fade-transition>
    <v-card v-if="request" class="quick-rating pa-3" rounded="lg" elevation="8">
      <div class="d-flex align-start ga-2">
        <span class="text-body-2 flex-grow-1">
          {{ thanked ? t("$vuetify.sessionRating.liveThanks") : title }}
        </span>
        <v-btn
          v-if="!thanked"
          icon="mdi-close"
          variant="text"
          size="x-small"
          :aria-label="t('$vuetify.sessionRating.notNow')"
          @click="dismiss"
        />
      </div>
      <v-rating
        v-if="!thanked"
        :model-value="stars"
        length="5"
        size="28"
        color="primary"
        hover
        density="compact"
        :disabled="sending"
        class="mt-1"
        @update:model-value="rate"
      />
    </v-card>
  </v-fade-transition>
</template>

<style scoped>
/* Over the chart's end side, below its tabs. */
.quick-rating {
  position: absolute;
  top: 40px;
  inset-inline-end: 8px;
  z-index: 3;
  width: 260px;
}
</style>
