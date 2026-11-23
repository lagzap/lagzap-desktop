<script setup lang="ts">
import { computed, ref } from "vue";
import { useLocale } from "vuetify";
import CountryFlag from "vue-country-flag-next";
import { useProfileWireGuard } from "~/composables/useProfileWireGuard";
import { useStore } from "@/stores";
import { formatMs } from "~/utils/localeFormat";

/** Under the profile while its Dedicated IP (WireGuard) is in use: the
 * server's flag, which config and IP, the ping through it, and Disable. */
const props = defineProps<{ profileId: string }>();
const { t } = useLocale();
const { status, selected, active, setEnabled } = useProfileWireGuard(props.profileId);
const busy = ref(false);

/** The right side: the ping while it works, else what is wrong. */
const right = computed(() => {
  switch (status.value.state) {
    case "working":
      return status.value.ping
        ? { color: "success", text: formatMs(status.value.ping) }
        : { color: "success", text: t("$vuetify.title.profile.wireguard.working") };
    case "connecting":
      return { color: "info", text: t("$vuetify.title.profile.wireguard.connecting") };
    case "no_internet":
      return { color: "warning", text: t("$vuetify.title.profile.wireguard.noInternet") };
    default:
      return { color: "error", text: t("$vuetify.title.profile.wireguard.failed") };
  }
});

/** The title's other profiles with their Dedicated IP on: Disable asks
 * whether it is this one only or all of them. */
const store = useStore();
const profile = computed(() => store.profiles.find((p) => p.id === props.profileId));
const others = computed(() =>
  store.profiles
    .filter((p) => p.title_id === profile.value?.title_id && p.id !== props.profileId)
    .map((p) => ({ profile: p, wg: useProfileWireGuard(p.id) }))
    .filter((o) => o.wg.summary.value.enabled),
);
const titleName = computed(() => {
  const title = store.titles.find((x) => x.id === profile.value?.title_id);
  return title ? String(store.localized(title.name) || "") : "";
});
const ask = ref(false);

function disable() {
  if (others.value.length) {
    ask.value = true;
    return;
  }
  void turnOff(false);
}
/** Off here, or on every profile of the title using it. */
async function turnOff(all: boolean) {
  ask.value = false;
  busy.value = true;
  try {
    await setEnabled(false);
    if (all) await Promise.all(others.value.map((o) => o.wg.setEnabled(false)));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <v-scale-transition>
    <div v-if="active && selected" class="wireguard-hint">
      <div class="wireguard-hint__badge">
        <CountryFlag v-if="selected.country" :country="selected.country" size="normal" />
        <v-icon v-else icon="mdi-tunnel-outline" size="20" />
      </div>
      <div class="wireguard-hint__text">
        <div class="text-body-2 font-weight-medium text-truncate">
          {{ t("$vuetify.title.profile.wireguard.using", selected.ip) }}
        </div>
        <div class="text-caption text-medium-emphasis text-truncate" dir="ltr">{{ selected.name }}</div>
      </div>
      <span class="text-body-2 font-weight-medium flex-none" :class="`text-${right.color}`">{{ right.text }}</span>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-power"
        class="text-none flex-none"
        :loading="busy"
        @click="disable"
      >
        {{ t("$vuetify.title.profile.wireguard.disable") }}
      </v-btn>
    </div>
  </v-scale-transition>
  <!-- Another of the title's profiles uses it too: this one, or all. -->
  <v-dialog v-model="ask" max-width="420">
    <v-card rounded="lg">
      <v-card-title>{{ t("$vuetify.title.profile.wireguard.disableAsk") }}</v-card-title>
      <v-card-text>
        {{ t("$vuetify.title.profile.wireguard.disableAskBody", String(store.localized(profile?.name ?? {}) || ""), titleName) }}
      </v-card-text>
      <v-card-actions>
        <v-btn class="text-none" @click="ask = false">{{ t("$vuetify.title.profile.wireguard.disableKeep") }}</v-btn>
        <v-spacer />
        <v-btn class="text-none" @click="turnOff(false)">
          {{ t("$vuetify.title.profile.wireguard.disableOnly", String(store.localized(profile?.name ?? {}) || "")) }}
        </v-btn>
        <v-btn class="text-none" color="error" variant="flat" @click="turnOff(true)">
          {{ t("$vuetify.title.profile.wireguard.disableAll") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* The same dashed card as the other profile hints. */
.wireguard-hint {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 10px 10px 14px;
  border: thin dashed rgba(var(--v-theme-primary), 0.35);
  border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.05);
}

.wireguard-hint__badge {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  overflow: hidden;
}

.wireguard-hint__text {
  flex: 1;
  min-width: 0;
}

.flex-none {
  flex: none;
}
</style>
