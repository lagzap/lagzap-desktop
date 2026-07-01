<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import { useLocale } from "vuetify";

const { t } = useLocale()
const { logs } = useMonitoringStore();

const search = ref<string>("");
const virtualScrollRef = ref();
const isAtBottom = ref(true);
const previousLogsLength = ref(0);

const filteredItems = computed(() => {
  if (!search.value) return logs.value;
  return logs.value.filter((log: any) => 
    JSON.stringify(log).toLowerCase().includes(search.value.toLowerCase())
  );
});

// Watch for new logs and auto-scroll if at bottom
watch(() => logs.value.length, (newLength) => {
  if (newLength > previousLogsLength.value && isAtBottom.value) {
    nextTick(() => {
      scrollToBottom();
    });
  }
  previousLogsLength.value = newLength;
});

const scrollToBottom = () => {
  if (virtualScrollRef.value) {
    const scrollElement = virtualScrollRef.value.$el.querySelector('.v-virtual-scroll__container');
    if (scrollElement) {
      scrollElement.scrollTop = scrollElement.scrollHeight;
    }
  }
};

const handleScroll = (event: Event) => {
  const target = event.target as HTMLElement;
  const threshold = 10; // pixels from bottom
  isAtBottom.value = target.scrollTop + target.clientHeight >= target.scrollHeight - threshold;
};

const getLogLevelColor = (level: string) => {
  switch (level?.toLowerCase()) {
    case 'panic': return 'red-darken-4';
    case 'fatal': return 'red-darken-2';
    case 'error': return 'error';
    case 'warning': case 'warn': return 'warning';
    case 'info': return 'info';
    case 'debug': return 'primary';
    case 'trace': return 'blue-grey';
    default: return 'grey';
  }
}

const formatLogEntry = (item: any) => {
  const level = item.type?.toUpperCase() || 'INFO';
  const timestamp = new Date(item.time || Date.now()).toLocaleString();
  const message = item.payload || 'No message';
  return `${level}[${item.id || '?'}] [${timestamp}] ${message}`;
}
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">{{ t('$vuetify.navigation.connections') }}</v-app-bar-title>
      </template>
      <v-toolbar class="bg-transparent px-3">
        <v-text-field
          v-model:model-value="search"
          variant="solo-filled"
          rounded="xl"
          density="compact"
          :label="t('$vuetify.common.search')"
          prepend-inner-icon="mdi-magnify"
          hide-details
          single-line
          style="width: 200px"
        />
      </v-toolbar>
      
      <!-- Console-style log output -->
      <v-sheet class="console-output">
        <v-virtual-scroll
          ref="virtualScrollRef"
          :height="$vuetify.display.height - 140"
          :items="filteredItems"
          class="console-scroll"
          @scroll="handleScroll"
        >
          <template v-slot:default="{ item }">
            <div class="console-line">
              <span class="text-white me-1 text-grey">[{{ new Date(item.time || Date.now()).toLocaleString() }}]</span>
              <span :class="`me-1 text-${getLogLevelColor(item.type)}`">{{ item.type?.toUpperCase() || 'INFO' }}</span>
              <span>{{ item.payload || 'No message' }}</span>
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
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  overflow: hidden;
}

.console-scroll {
  background-color: #1a1a1a;
  user-select: text !important;
}

.console-line {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
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