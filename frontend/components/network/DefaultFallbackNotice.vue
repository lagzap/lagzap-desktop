<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { Events } from "@wailsio/runtime";
import { useLocale } from "vuetify";
import { GetDefaultInterfaceFallback } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { displayAlert } from "~/composables/alert";

/** Shown while LagZap left the main adapter (picked Default, else Windows'
 * default) because it has no internet, and once when it is back on it. The
 * backend decides when to switch; this only reports it. */
interface Fallback {
  active: boolean;
  wanted: string;
  using: string;
}

const { t } = useLocale();
const fallback = ref<Fallback | null>(null);
const dismissed = ref(false);

function asFallback(data: unknown): Fallback | null {
  const raw = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<Fallback>;
  return { active: value.active === true, wanted: value.wanted ?? "", using: value.using ?? "" };
}

function apply(next: Fallback | null, announce: boolean) {
  const prev = fallback.value;
  fallback.value = next;
  if (!next?.active) {
    if (announce && prev?.active && next?.using === prev.wanted) {
      displayAlert(t("$vuetify.status.defaultFallbackRestored", prev.wanted), "success", 6000);
    }
    return;
  }
  if (!prev?.active || prev.wanted !== next.wanted || prev.using !== next.using) {
    dismissed.value = false;
  }
}

async function load() {
  try {
    apply(asFallback(await GetDefaultInterfaceFallback()), false);
  } catch {
    // service not running yet; the event brings the state
  }
}

const offs: Array<() => void> = [];
onMounted(() => {
  void load();
  offs.push(Events.On("default-interface-fallback", ({ data }: any) => apply(asFallback(data), true)));
  offs.push(Events.On("service-started", () => void load()));
});
onUnmounted(() => offs.forEach((off) => off()));
</script>

<template>
  <v-snackbar
    :model-value="!!fallback?.active && !dismissed"
    :timeout="-1"
    location="bottom"
    color="warning"
    variant="tonal"
    rounded="lg"
    class="default-fallback"
  >
    <div class="d-flex align-center ga-3">
      <v-icon icon="mdi-swap-horizontal" />
      <span>{{ t("$vuetify.status.defaultFallbackActive", fallback?.wanted ?? "", fallback?.using ?? "") }}</span>
    </div>
    <template #actions>
      <v-btn icon="mdi-close" size="small" variant="text" @click="dismissed = true" />
    </template>
  </v-snackbar>
</template>

<style scoped>
.default-fallback :deep(.v-snackbar__wrapper) {
  backdrop-filter: blur(8px);
  background: rgb(var(--v-theme-surface) / 0.92);
}
</style>
