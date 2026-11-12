<script setup lang="ts">
import { useLocale } from "vuetify";
import type { LoadBalanceShare } from "~/bindings/github.com/lagzap/lagzap/adapter";
import AdapterPing from "~/components/network/AdapterPing.vue";
import LoadBalanceWeight from "~/components/title/LoadBalanceWeight.vue";
import { localDigits } from "~/utils/localeFormat";

// Load balancing for a High traffic profile: a checkbox, and its internets
// as checkboxes under it. Untouched, the ticked ones are those flagged Load
// balance on the Multi Internet page ("pool"); ticking or unticking one makes
// the ticked ones the profile's own ("pick"). Each shows its share of new
// connections and its ping.
export type LoadBalanceMode = "off" | "pool" | "pick";

const props = defineProps<{
  mode: LoadBalanceMode;
  /** Internets listed: the pool's (pool) or every one to pick from (pick). */
  adapters: string[];
  /** Picked internets (pick). */
  selected: string[];
  missing: string[];
  shares: Record<string, LoadBalanceShare>;
  loading: boolean;
  disabled?: boolean;
  /** The menu is open: only then the pings stream. */
  live?: boolean;
  icon: (name: string) => string;
}>();
const emit = defineEmits<{
  mode: [mode: LoadBalanceMode];
  pick: [name: string];
  weight: [name: string, weight: number];
  refresh: [];
}>();
const { t } = useLocale();

function toggle() {
  emit("mode", props.mode === "off" ? "pool" : "off");
}
const inUse = (name: string) => props.selected.includes(name);
const count = computed(() => props.adapters.filter(inUse).length);
/** Settings has fewer than two internets flagged: nothing is spread. */
const poolTooSmall = computed(() => props.mode === "pool" && count.value < 2);

// The last two picked cannot be unticked: a short note says why.
const lockedHint = ref("");
let hintTimer: ReturnType<typeof setTimeout> | undefined;
function onRow(name: string) {
  if (inUse(name) && props.selected.length <= 2) {
    lockedHint.value = name;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (lockedHint.value = ""), 3000);
    return;
  }
  emit("pick", name);
}
onBeforeUnmount(() => clearTimeout(hintTimer));
</script>

<template>
  <v-list-item
    :class="['load-balance', { 'load-balance--on': mode !== 'off' }]"
    :disabled="disabled"
    @click="toggle"
  >
    <template #prepend>
      <v-checkbox-btn
        class="me-2 state-only"
        density="compact"
        color="primary"
        :model-value="mode !== 'off'"
      />
    </template>
    <template #title>
      <v-avatar size="24" rounded="0">
        <v-icon :color="mode !== 'off' ? 'primary' : undefined">mdi-scale-balance</v-icon>
      </v-avatar>
      <span class="text-caption ms-2">{{ t("$vuetify.title.profile.server.loadBalance") }}</span>
    </template>
    <template #append>
      <span v-if="poolTooSmall" class="text-caption text-medium-emphasis">
        {{ t("$vuetify.title.profile.server.loadBalancePoolOff") }}
      </span>
      <span v-else-if="mode !== 'off'" class="text-caption text-primary d-flex align-center">
        <v-icon size="14" class="me-1">mdi-check</v-icon>
        {{ t("$vuetify.title.profile.server.loadBalanceCount", localDigits(count)) }}
      </span>
      <span v-else class="text-caption text-medium-emphasis">
        {{ t("$vuetify.title.profile.server.multiInternetOff") }}
      </span>
      <template v-if="mode !== 'off'">
        <v-tooltip :text="t('$vuetify.title.profile.server.directRefresh')" location="top" open-delay="200">
          <template #activator="{ props: tip }">
            <v-btn
              v-bind="tip"
              icon
              size="x-small"
              variant="text"
              density="comfortable"
              class="ms-1"
              :loading="loading"
              @click.stop="emit('refresh')"
            >
              <v-icon size="15">mdi-refresh</v-icon>
            </v-btn>
          </template>
        </v-tooltip>
      </template>
    </template>
  </v-list-item>
  <v-list-item v-if="poolTooSmall" density="compact" class="ms-8" to="/multi-internet">
    <template #title>
      <span class="text-caption text-medium-emphasis">{{ t("$vuetify.title.profile.server.loadBalancePoolHint") }}</span>
    </template>
    <template #append>
      <v-icon size="16">mdi-chevron-right</v-icon>
    </template>
  </v-list-item>
  <template v-if="mode !== 'off'">
    <v-list-item
      v-for="name in adapters"
      :key="name"
      density="compact"
      class="ms-8"
      :disabled="disabled"
      @click="onRow(name)"
    >
      <template #prepend>
        <v-checkbox-btn
          class="me-2 state-only"
          density="compact"
          :color="missing.includes(name) ? 'warning' : 'primary'"
          :model-value="inUse(name)"
        />
      </template>
      <template #title>
        <v-icon size="16" class="me-2" :class="{ 'text-medium-emphasis': !inUse(name) }">{{ icon(name) }}</v-icon>
        <span class="text-caption" :class="{ 'text-medium-emphasis': !inUse(name) }">{{ name }}</span>
      </template>
      <template #append>
        <span v-if="lockedHint === name" class="text-caption text-warning locked-hint">
          {{ t("$vuetify.title.profile.server.loadBalanceMinTwoShort") }}
        </span>
        <span v-else-if="missing.includes(name)" class="text-caption text-warning">
          {{ t("$vuetify.title.profile.server.adapterGone") }}
        </span>
        <template v-else>
          <LoadBalanceWeight
            v-if="inUse(name)"
            :share="shares[name]"
            @set="(weight: number) => emit('weight', name, weight)"
          />
          <AdapterPing v-if="live" :name="name" />
        </template>
      </template>
    </v-list-item>
  </template>
</template>

<style scoped>
.load-balance--on {
  background: rgba(var(--v-theme-primary), 0.06);
}
/* Shows the state only: the row takes the click. */
.state-only {
  pointer-events: none;
}
.locked-hint {
  max-width: 220px;
  text-align: end;
  line-height: 1.2;
}
</style>
