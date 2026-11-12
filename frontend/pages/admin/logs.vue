<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import { useLocale } from "vuetify";

definePageMeta({
  layout: "admin",
  sanctum: {
    excluded: true,
  },
});

const { t } = useLocale();
const { logs } = useMonitoringStore();

const search = ref("");
const virtualScrollRef = ref<{ $el?: HTMLElement } | null>(null);
const stickToBottom = ref(true);
const programmaticScroll = ref(false);
const BOTTOM_THRESHOLD = 24;

// Scrolled up (paused): the list holds still on what you are reading. The
// live list keeps only the newest lines, so following it would push the old
// ones out from under you; new lines wait until you follow again.
const frozen = ref<typeof logs.value | null>(null);
watch(stickToBottom, (following) => {
  frozen.value = following ? null : logs.value.slice();
});
const shown = computed(() => frozen.value ?? logs.value);
/** Lines logged since pausing. */
const newSincePause = computed(() => {
  const last = frozen.value?.[frozen.value.length - 1]?.time;
  if (!frozen.value || !last) return 0;
  const since = new Date(last as any).getTime();
  return logs.value.filter((log: any) => new Date(log.time).getTime() > since).length;
});

const filteredItems = computed(() => {
  if (!search.value) return shown.value;
  const q = search.value.toLowerCase();
  return shown.value.filter((log: any) =>
    JSON.stringify(log).toLowerCase().includes(q)
  );
});

function getScrollEl(): HTMLElement | null {
  return virtualScrollRef.value?.$el ?? null;
}

function isNearBottom(el: HTMLElement) {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_THRESHOLD;
}

function scrollToBottom() {
  const el = getScrollEl();
  if (!el) return;
  programmaticScroll.value = true;
  el.scrollTop = el.scrollHeight;
  // release after layout settles
  requestAnimationFrame(() => {
    programmaticScroll.value = false;
    stickToBottom.value = true;
  });
}

function handleScroll() {
  if (programmaticScroll.value) return;
  const el = getScrollEl();
  if (!el) return;
  stickToBottom.value = isNearBottom(el);
}

function maybeStick() {
  if (!stickToBottom.value) return;
  nextTick(() => {
    scrollToBottom();
  });
}

watch(
  () => filteredItems.value.length,
  () => {
    maybeStick();
  }
);

watch(search, () => {
  if (stickToBottom.value) {
    nextTick(() => scrollToBottom());
  }
});

onMounted(() => {
  nextTick(() => scrollToBottom());
});

const getLogLevelColor = (level: string) => {
  switch (level?.toLowerCase()) {
    case "panic":
      return "red-darken-4";
    case "fatal":
      return "red-darken-2";
    case "error":
      return "error";
    case "warning":
    case "warn":
      return "warning";
    case "info":
      return "info";
    case "debug":
      return "primary";
    case "trace":
      return "blue-grey";
    default:
      return "grey";
  }
};
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">{{
          t("$vuetify.navigation.logs")
        }}</v-app-bar-title>
      </template>
      <v-toolbar class="bg-transparent px-3">
        <v-text-field
          v-model="search"
          variant="solo-filled"
          rounded="xl"
          density="compact"
          :label="t('$vuetify.common.search')"
          prepend-inner-icon="mdi-magnify"
          hide-details
          single-line
          style="width: 200px"
        />
        <v-spacer />
        <v-chip
          size="small"
          variant="tonal"
          :color="stickToBottom ? 'success' : 'default'"
          class="me-2"
        >
          {{ stickToBottom ? "Following" : "Paused" }}
        </v-chip>
        <v-btn
          v-if="!stickToBottom"
          size="small"
          variant="tonal"
          rounded="xl"
          prepend-icon="mdi-arrow-down"
          @click="scrollToBottom"
        >
          Jump to bottom<template v-if="newSincePause"> ({{ newSincePause }} new)</template>
        </v-btn>
      </v-toolbar>

      <v-sheet class="console-output">
        <v-virtual-scroll
          ref="virtualScrollRef"
          :height="$vuetify.display.height - 140"
          :items="filteredItems"
          class="console-scroll"
          @scroll.passive="handleScroll"
        >
          <template #default="{ item }">
            <div class="console-line">
              <span class="text-white me-1 text-grey"
                >[{{
                  new Date(item.time || Date.now()).toLocaleString()
                }}]</span
              >
              <span :class="`me-1 text-${getLogLevelColor(item.type)}`">{{
                item.type?.toUpperCase() || "INFO"
              }}</span>
              <span>{{ item.payload || "No message" }}</span>
            </div>
          </template>
        </v-virtual-scroll>
      </v-sheet>
    </Container>
  </div>
</template>

<style lang="scss" scoped>
.console-output {
  border-radius: 4px;
  margin: 8px;
  font-family: "Consolas", "Monaco", "Courier New", monospace;
  overflow: hidden;
}

.console-scroll {
  background-color: #1a1a1a;
  user-select: text !important;
}

.console-line {
  font-family: "Consolas", "Monaco", "Courier New", monospace;
  font-size: 12px;
  line-height: 1.4;
  padding: 2px 8px;
  white-space: pre-wrap;
  word-break: break-all;
  border-bottom: 1px solid #2a2a2a;
  user-select: text !important;
  cursor: text;

  > * {
    user-select: text !important;
  }
}

.console-line:hover {
  background-color: #2a2a2a;
}

.console-line:last-child {
  border-bottom: none;
}
</style>
