<script setup lang="ts">
import { onUnmounted, ref, shallowRef, watch } from "vue";
import { useLocale } from "vuetify";
import { GetProfileLog, GetTitleLog } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { ConnectionLogLine } from "~/bindings/github.com/lagzap/lagzap/adapter";
import AdminStats from "~/components/admin/AdminStats.vue";
import ConsoleLog from "~/components/admin/ConsoleLog.vue";

/** Admins: a profile's or title's console log (every connection, live and
 * ended, merged by time) and its statistics, live. */
const props = withDefaults(defineProps<{ kind: "profile" | "title"; id: string; logHeight?: number | string }>(), {
  logHeight: 480,
});

const { t } = useLocale();
const tab = ref<"log" | "stats">("log");
const lines = shallowRef<ConnectionLogLine[]>([]);

async function refreshLog() {
  if (tab.value !== "log" || document.hidden || !props.id) return;
  const want = props.id;
  try {
    const got = (await (props.kind === "profile" ? GetProfileLog(want) : GetTitleLog(want))) ?? [];
    if (want === props.id) lines.value = got;
  } catch {
    // not an admin (any more) or the service is not running
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
watch(
  () => [props.kind, props.id],
  () => {
    lines.value = [];
    void refreshLog();
  },
  { immediate: true },
);
watch(tab, (now) => now === "log" && void refreshLog());
timer = setInterval(refreshLog, 2000);
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <div>
    <v-tabs v-model="tab" density="compact" color="info" class="mb-3">
      <v-tab value="log" prepend-icon="mdi-console">{{ t("$vuetify.consoleLog.tabLog") }}</v-tab>
      <v-tab value="stats" prepend-icon="mdi-chart-timeline-variant">{{ t("$vuetify.consoleLog.tabStats") }}</v-tab>
    </v-tabs>
    <ConsoleLog v-if="tab === 'log'" :lines="lines" :height="logHeight" />
    <AdminStats v-else :kind="kind" :id="id" />
  </div>
</template>
