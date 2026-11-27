<script setup lang="ts">
import type { DataTableHeader } from "vuetify";
import { useLocale } from "vuetify";
import Container from "~/components/layout/Container.vue";
import { GetDNSQueries, GetProfiles } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { DNSQueryRecord } from "~/bindings/github.com/lagzap/lagzap/adapter/models";

definePageMeta({
  layout: "admin",
  sanctum: {
    excluded: true,
  },
});

const { t } = useLocale();
const store = useStore();

/** Every DNS lookup an app sent that LagZap captured, newest first, with
 * where it went: through a relay, straight to a server, the cache, or a
 * rule that answered or refused it. */
const KEEP = 2000;
const queries = ref<DNSQueryRecord[]>([]);
const paused = ref(false);
let lastId = 0;

/** The cell just copied (row and column): it shows a check for a moment. */
const copied = ref("");
let copiedTimer: ReturnType<typeof setTimeout> | undefined;

async function copy(key: string, value: string | undefined) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    return; // clipboard refused
  }
  copied.value = key;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => (copied.value = ""), 1200);
}

async function poll() {
  if (paused.value) return;
  try {
    const fresh = (await GetDNSQueries(lastId)) ?? [];
    if (!fresh.length) return;
    lastId = fresh[fresh.length - 1].id;
    queries.value = [...fresh.reverse(), ...queries.value].slice(0, KEEP);
  } catch {
    // service not running yet
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
onMounted(async () => {
  try {
    if (!store.profiles.length) store.profiles = Object.values(await GetProfiles());
  } catch {
    // service not running yet: rules show by tag
  }
  void poll();
  timer = setInterval(poll, 1000);
});
onUnmounted(() => clearInterval(timer));

function clearList() {
  queries.value = [];
}

const profileById = computed(() => new Map(store.profiles.map((profile) => [profile.id, profile])));

/** A DNS rule's tag is its profile's id; the built-in ones keep their tag. */
function ruleName(tag: string): string {
  const profile = profileById.value.get(tag);
  return profile ? store.localized(profile.name) : tag;
}

function processName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

const OUTCOMES: Record<string, { label: string; color: string }> = {
  proxied: { label: "Proxied", color: "success" },
  direct: { label: "Direct", color: "info" },
  cache: { label: "Cache", color: "secondary" },
  fakeip: { label: "Fake IP", color: "purple" },
  answered: { label: "Answered", color: "secondary" },
  rejected: { label: "Rejected", color: "warning" },
  failed: { label: "Failed", color: "error" },
};
function outcome(name: string) {
  return OUTCOMES[name] ?? { label: name, color: "default" };
}

const outcomeFilter = ref<string[]>([]);
const search = ref("");

const items = computed(() =>
  queries.value
    .filter((query) => !outcomeFilter.value.length || outcomeFilter.value.includes(query.outcome))
    .map((query) => ({
      ...query,
      process_name: query.process ? processName(query.process) : "",
      rule_name: query.rule ? ruleName(query.rule) : "",
      answer_text: (query.answers ?? []).join(", "),
    }))
);

/** Lookups per outcome, for the filter chips. */
const counts = computed(() => {
  const out: Record<string, number> = {};
  for (const query of queries.value) out[query.outcome] = (out[query.outcome] ?? 0) + 1;
  return out;
});

const headers: DataTableHeader[] = [
  { title: "Time", key: "time", align: "start", nowrap: true, width: "90px" },
  { title: "App", key: "process_name", align: "start", nowrap: true, width: "150px" },
  { title: "Type", key: "type", align: "center", nowrap: true, width: "70px" },
  { title: "Name", key: "name", align: "start", nowrap: true },
  { title: "Went", key: "outcome", align: "start", nowrap: true, width: "200px" },
  { title: "Rule", key: "rule_name", align: "start", nowrap: true, width: "160px" },
  { title: "Answer", key: "answer_text", align: "start", nowrap: true, width: "240px" },
  { title: "Took", key: "duration_ms", align: "end", nowrap: true, width: "70px" },
];
</script>

<template>
  <div>
    <Container>
      <Teleport defer to="#admin-bar-actions">
        <div class="d-flex align-center ga-2">
          <v-btn
            :icon="paused ? 'mdi-play' : 'mdi-pause'"
            size="small"
            variant="tonal"
            v-tooltip="paused ? 'Resume' : 'Pause'"
            @click="paused = !paused"
          />
          <v-btn icon="mdi-delete-sweep-outline" size="small" variant="tonal" v-tooltip="'Clear'" @click="clearList" />
          <v-text-field
            v-model:model-value="search"
            variant="solo-filled"
            flat
            rounded="xl"
            density="compact"
            :placeholder="t('$vuetify.common.search')"
            prepend-inner-icon="mdi-magnify"
            hide-details
            single-line
            clearable
            style="width: 280px"
          />
        </div>
      </Teleport>

      <v-chip-group v-model="outcomeFilter" multiple class="px-2">
        <v-chip
          v-for="(info, name) in OUTCOMES"
          :key="name"
          :value="name"
          :color="info.color"
          size="small"
          variant="tonal"
          filter
        >
          {{ info.label }} {{ counts[name] ?? 0 }}
        </v-chip>
      </v-chip-group>

      <v-data-table-virtual
        :search
        :headers
        :items
        density="compact"
        fixed-header
        hide-default-footer
        :height="$vuetify.display.height - 112"
        class="bg-transparent"
      >
        <template v-slot:item.time="{ item }">
          <span class="text-medium-emphasis">{{ new Date(item.time).toLocaleTimeString() }}</span>
        </template>
        <template v-slot:item.process_name="{ item }">
          <div class="cell-text" v-tooltip="item.process || item.source">
            {{ item.process_name || "-" }}
          </div>
          <div class="text-caption text-medium-emphasis cell-text">{{ item.source }} · {{ item.network }}</div>
        </template>
        <template v-slot:item.type="{ item }">
          <v-chip size="x-small" variant="tonal" label>{{ item.type }}</v-chip>
        </template>
        <template v-slot:item.name="{ item }">
          <span
            class="cell-text d-inline-block name-cell copyable"
            v-tooltip="item.name"
            @click.stop="copy(`${item.id}:name`, item.name)"
          >{{ item.name }}<v-icon v-if="copied === `${item.id}:name`" icon="mdi-check" size="14" color="success" class="ms-1" /></span>
        </template>
        <template v-slot:item.outcome="{ item }">
          <div class="d-flex align-center ga-2">
            <v-chip :color="outcome(item.outcome).color" size="x-small" variant="tonal">
              {{ outcome(item.outcome).label }}
            </v-chip>
            <span class="text-caption text-medium-emphasis">{{ item.server }}</span>
          </div>
          <div v-if="item.error" class="text-caption text-error cell-text" v-tooltip="item.error">{{ item.error }}</div>
        </template>
        <template v-slot:item.rule_name="{ item }">
          <span v-if="item.rule_name" class="cell-text">{{ item.rule_name }}</span>
          <span v-else class="text-medium-emphasis">default</span>
        </template>
        <template v-slot:item.answer_text="{ item }">
          <span
            v-if="item.answer_text"
            class="cell-text d-inline-block answer-cell copyable"
            v-tooltip="item.answer_text"
            @click.stop="copy(`${item.id}:answer`, item.answer_text)"
          >{{ item.answer_text }}<v-icon v-if="copied === `${item.id}:answer`" icon="mdi-check" size="14" color="success" class="ms-1" /></span>
          <span v-else class="text-medium-emphasis">{{ item.rcode || "-" }}</span>
        </template>
        <template v-slot:item.duration_ms="{ item }">
          <span class="text-medium-emphasis">{{ item.duration_ms }} ms</span>
        </template>
      </v-data-table-virtual>
    </Container>
  </div>
</template>

<style scoped>
.cell-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.name-cell {
  max-width: 320px;
}

.answer-cell {
  max-width: 230px;
}

.copyable {
  cursor: pointer;
  border-radius: 4px;
  transition: color 0.15s ease;
}

.copyable:hover {
  color: rgb(var(--v-theme-primary));
}
</style>
