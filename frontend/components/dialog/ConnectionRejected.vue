<script setup lang="ts">
import { Events } from "@wailsio/runtime";
import { useLocale } from "vuetify";

/** A profile's connection was rejected: no LagZap server in its location
 * selection could carry it, and LagZap never moves a game outside the user's
 * pick or straight to the game server ("connection-rejected"; Go tells once in
 * a while per profile). The user turns the profile off or picks another
 * location. */
interface Rejection {
  profile_id: string;
  title_id: string;
  code: string;
  selection?: string;
  network: string;
}

const { t } = useLocale();
const store = useStore();
const router = useRouter();

const open = ref(false);
const rejection = ref<Rejection | null>(null);
const turningOff = ref(false);

const gameName = computed(() => {
  const game = store.titles.find((item) => item.id === rejection.value?.title_id);
  return game ? store.titleName(game.name) : "";
});

const title = computed(() =>
  gameName.value
    ? t("$vuetify.connectionRejected.titleGame", [gameName.value])
    : t("$vuetify.connectionRejected.title"),
);

const reason = computed(() => {
  const r = rejection.value;
  if (!r) return "";
  if (r.code === "no_route") {
    return r.selection
      ? t("$vuetify.connectionRejected.noRouteIn", [r.selection])
      : t("$vuetify.connectionRejected.noRoute");
  }
  return r.selection
    ? t("$vuetify.connectionRejected.noServerIn", [r.selection])
    : t("$vuetify.connectionRejected.noServer");
});

async function turnOff() {
  const id = rejection.value?.profile_id;
  if (!id) return;
  turningOff.value = true;
  try {
    if (store.isProfileActive(id)) await store.deactivateProfile(id);
    open.value = false;
  } finally {
    turningOff.value = false;
  }
}

function changeLocation() {
  const id = rejection.value?.title_id;
  open.value = false;
  if (id) void router.push({ name: "title-id", params: { id } });
}

let off: (() => void) | undefined;
onMounted(() => {
  off = Events.On("connection-rejected", ({ data }: any) => {
    const next = (Array.isArray(data) ? data[0] : data) as Rejection | undefined;
    if (!next?.profile_id) return;
    rejection.value = next;
    open.value = true;
  });
});
onUnmounted(() => off?.());
</script>

<template>
  <v-dialog v-model="open" max-width="460">
    <v-card :title="title" prepend-icon="mdi-shield-alert-outline">
      <v-card-text class="pt-1">
        <div class="text-body-2 mb-2">{{ reason }}</div>
        <div class="text-body-2 text-medium-emphasis">
          {{ t("$vuetify.connectionRejected.hint") }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-btn variant="text" @click="open = false">
          {{ t("$vuetify.connectionRejected.close") }}
        </v-btn>
        <v-spacer />
        <v-btn variant="tonal" :loading="turningOff" @click="turnOff">
          {{ t("$vuetify.connectionRejected.turnOff") }}
        </v-btn>
        <v-btn color="primary" variant="flat" @click="changeLocation">
          {{ t("$vuetify.connectionRejected.changeLocation") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
