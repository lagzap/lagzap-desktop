<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { Events } from "@wailsio/runtime";
import { useLocale } from "vuetify";
import { GetTrafficTakeover } from "~/bindings/github.com/lagzap/lagzap-desktop/service";

/** Shown while another VPN app holds the PC's internet route (and DNS):
 * LagZap cannot proxy DNS requests then, and that app may block LagZap.
 * The backend detects it; this only reports it. */
interface Takeover {
  active: boolean;
  adapter: string;
  route: boolean;
  dns: boolean;
}

const { t } = useLocale();
const takeover = ref<Takeover | null>(null);
/** The adapter the user closed the notice for; another one shows it again. */
const dismissedFor = ref("");

function asTakeover(data: unknown): Takeover | null {
  const raw = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<Takeover>;
  return {
    active: value.active === true,
    adapter: value.adapter ?? "",
    route: value.route === true,
    dns: value.dns === true,
  };
}

const shown = computed(() => !!takeover.value?.active && dismissedFor.value !== takeover.value.adapter);
const text = computed(() =>
  t(takeover.value?.dns ? "$vuetify.status.trafficTakeoverDns" : "$vuetify.status.trafficTakeoverRoute", takeover.value?.adapter ?? "")
);

async function load() {
  try {
    takeover.value = asTakeover(await GetTrafficTakeover());
  } catch {
    // service not running yet; the event brings the state
  }
}

const offs: Array<() => void> = [];
onMounted(() => {
  void load();
  offs.push(Events.On("traffic-takeover", ({ data }: any) => (takeover.value = asTakeover(data))));
  offs.push(Events.On("service-started", () => void load()));
});
onUnmounted(() => offs.forEach((off) => off()));
</script>

<template>
  <v-snackbar
    :model-value="shown"
    :timeout="-1"
    location="top"
    color="warning"
    variant="tonal"
    rounded="lg"
    class="traffic-takeover"
  >
    <div class="d-flex align-center ga-3">
      <v-icon icon="mdi-shield-alert-outline" />
      <span>{{ text }}</span>
    </div>
    <template #actions>
      <v-btn icon="mdi-close" size="small" variant="text" @click="dismissedFor = takeover?.adapter ?? ''" />
    </template>
  </v-snackbar>
</template>

<style scoped>
.traffic-takeover :deep(.v-snackbar__wrapper) {
  /* Below the window's title bar (the tallest app bar is 56px). */
  margin-top: 64px;
  backdrop-filter: blur(8px);
  background: rgb(var(--v-theme-surface) / 0.92);
}
</style>
