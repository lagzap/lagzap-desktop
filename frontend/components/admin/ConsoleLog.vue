<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useLocale } from "vuetify";
import type { ConnectionLogLine } from "~/bindings/github.com/lagzap/lagzap/adapter";

/** Console lines in Admin Tools' look (Logs page): time, colored level,
 * text. Text can be selected; lines wrap or scroll sideways; it follows new
 * lines until scrolled up. */
const props = withDefaults(defineProps<{ lines: ConnectionLogLine[]; height?: number | string }>(), {
  height: 320,
});

const { t } = useLocale();
const search = ref("");
const wrap = ref(true);
const box = ref<HTMLElement | null>(null);
const following = ref(true);

const shown = computed(() => {
  const q = search.value.trim().toLowerCase();
  return q ? props.lines.filter((line) => line.text.toLowerCase().includes(q)) : props.lines;
});

/** Same colors as Admin Tools' Logs page. */
function levelColor(level: string) {
  switch (level?.toLowerCase()) {
    case "panic":
      return "red-darken-4";
    case "fatal":
      return "red-darken-2";
    case "error":
      return "error";
    case "warn":
    case "warning":
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
}

function time(at: number) {
  return new Date(at).toLocaleTimeString();
}

function onScroll() {
  const el = box.value;
  if (el) following.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
}

function toBottom() {
  const el = box.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
  following.value = true;
}

watch(
  () => shown.value.length,
  async () => {
    if (!following.value) return;
    await nextTick();
    toBottom();
  },
  { immediate: true },
);

function copyAll() {
  void navigator.clipboard?.writeText(shown.value.map((line) => line.text).join("\n"));
}
</script>

<template>
  <div class="console-log">
    <div class="console-log__bar">
      <v-text-field
        v-model="search"
        variant="solo-filled"
        rounded="xl"
        density="compact"
        flat
        :placeholder="t('$vuetify.common.search')"
        prepend-inner-icon="mdi-magnify"
        hide-details
        single-line
        clearable
        class="console-log__search"
      />
      <v-spacer />
      <v-chip size="small" variant="tonal" :color="following ? 'success' : 'default'">
        {{ following ? t("$vuetify.consoleLog.following") : t("$vuetify.consoleLog.paused") }}
      </v-chip>
      <v-btn
        v-if="!following"
        v-tooltip:top="t('$vuetify.consoleLog.toBottom')"
        icon="mdi-arrow-down"
        size="small"
        variant="tonal"
        :aria-label="t('$vuetify.consoleLog.toBottom')"
        @click="toBottom"
      />
      <v-btn
        v-tooltip:top="wrap ? t('$vuetify.consoleLog.scroll') : t('$vuetify.consoleLog.wrap')"
        :icon="wrap ? 'mdi-arrow-expand-horizontal' : 'mdi-wrap'"
        size="small"
        variant="tonal"
        :color="wrap ? undefined : 'info'"
        :aria-label="wrap ? t('$vuetify.consoleLog.scroll') : t('$vuetify.consoleLog.wrap')"
        @click="wrap = !wrap"
      />
      <v-btn
        v-tooltip:top="t('$vuetify.consoleLog.copy')"
        icon="mdi-content-copy"
        size="small"
        variant="tonal"
        :disabled="!shown.length"
        :aria-label="t('$vuetify.consoleLog.copy')"
        @click="copyAll"
      />
    </div>
    <div
      ref="box"
      class="console-log__output"
      :class="{ 'console-log__output--nowrap': !wrap }"
      :style="{ height: typeof height === 'number' ? `${height}px` : height }"
      dir="ltr"
      @scroll.passive="onScroll"
    >
      <div v-if="!shown.length" class="console-log__empty">
        {{ lines.length ? t("$vuetify.consoleLog.noMatch") : t("$vuetify.consoleLog.empty") }}
      </div>
      <div v-for="(line, i) in shown" :key="i" class="console-log__line">
        <span class="text-grey me-1">[{{ time(line.at) }}]</span>
        <span :class="`me-1 text-${levelColor(line.level)}`">{{ line.level.toUpperCase() }}</span>
        <span>{{ line.text }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.console-log__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.console-log__search {
  flex: 0 1 220px;
}

/* Admin Tools' console: dark, monospace, a hairline between lines. */
.console-log__output {
  overflow: auto;
  border-radius: 4px;
  background-color: #1a1a1a;
  color: #e6e6e6;
  font-family: "Consolas", "Monaco", "Courier New", monospace;
  text-align: left;
  user-select: text;
  cursor: text;
}

.console-log__output * {
  user-select: text !important;
}

.console-log__line {
  padding: 2px 8px;
  border-bottom: 1px solid #2a2a2a;
  font-size: 12px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
}

.console-log__line:hover {
  background-color: #2a2a2a;
}

.console-log__line:last-child {
  border-bottom: none;
}

/* Scroll: one line per line, sideways when long. */
.console-log__output--nowrap .console-log__line {
  width: max-content;
  min-width: 100%;
  white-space: pre;
  word-break: normal;
}

.console-log__empty {
  padding: 12px;
  color: #8a8a8a;
  font-size: 12px;
}
</style>
