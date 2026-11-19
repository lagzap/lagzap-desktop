<script setup lang="ts">
import { useLocale } from "vuetify";
import type { LoadBalanceShare } from "~/bindings/github.com/lagzap/lagzap/adapter";
import AdapterPing from "~/components/network/AdapterPing.vue";
import LoadBalanceWeight from "~/components/title/LoadBalanceWeight.vue";
import { localDigits } from "~/utils/localeFormat";

// Load balancing for a High traffic profile: a checkbox, and its internets
// under it. On: checkboxes; untouched, the ticked ones are those flagged
// Load balance on the Multi Internet page ("pool"), ticking or unticking one
// makes the ticked ones the profile's own ("pick"), and unticking down to one
// turns it off on that one. Off: radios, the one internet the profile uses.
// Each shows its share of new connections and its ping.
export type LoadBalanceMode = "off" | "pool" | "pick";

const props = defineProps<{
  mode: LoadBalanceMode;
  /** Internets listed: the pool's (pool) or every one to pick from (pick). */
  adapters: string[];
  /** Picked internets (pick). */
  selected: string[];
  /** Off: the internets to choose one from, and the one in use. */
  singleAdapters: string[];
  single: string;
  missing: string[];
  shares: Record<string, LoadBalanceShare>;
  loading: boolean;
  disabled?: boolean;
  /** The menu is open: only then the pings stream. */
  live?: boolean;
  /** Opened from a tip's Set up: stands out for a moment. */
  highlight?: boolean;
  icon: (name: string) => string;
  /** Why load balancing cannot be on (a Dedicated IP): the switch is off
   * and fixed, one internet is picked below. */
  locked?: string;
}>();
const emit = defineEmits<{
  mode: [mode: LoadBalanceMode];
  pick: [name: string];
  single: [name: string];
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

const on = computed(() => props.mode !== "off");
function onRow(name: string) {
  if (on.value) emit("pick", name);
  else emit("single", name);
}
</script>

<template>
  <v-list-item
    :class="['load-balance', { 'load-balance--on': mode !== 'off', 'internets-highlight': highlight }]"
    :disabled="disabled || !!locked"
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
      <span v-if="locked" class="text-caption text-medium-emphasis">{{ locked }}</span>
      <span v-else-if="poolTooSmall" class="text-caption text-medium-emphasis">
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
  <v-list-item
    v-for="name in on ? adapters : singleAdapters"
      :key="name"
      density="compact"
      class="ms-8"
      :disabled="disabled"
      @click="onRow(name)"
    >
      <template #prepend>
        <v-checkbox-btn
          v-if="on"
          class="me-2 state-only"
          density="compact"
          :color="missing.includes(name) ? 'warning' : 'primary'"
          :model-value="inUse(name)"
        />
        <v-radio
          v-else
          hide-details
          class="me-2 state-only"
          density="compact"
          :color="missing.includes(name) ? 'warning' : 'primary'"
          :model-value="single === name"
        />
      </template>
      <template #title>
        <v-icon size="16" class="me-2" :class="{ 'text-medium-emphasis': on ? !inUse(name) : single !== name }">{{ icon(name) }}</v-icon>
        <span class="text-caption" :class="{ 'text-medium-emphasis': on ? !inUse(name) : single !== name }">{{ name }}</span>
      </template>
      <template #append>
        <span v-if="missing.includes(name)" class="text-caption text-warning">
          {{ t("$vuetify.title.profile.server.adapterGone") }}
        </span>
        <template v-else>
          <LoadBalanceWeight
            v-if="on && inUse(name)"
            :share="shares[name]"
            @set="(weight: number) => emit('weight', name, weight)"
          />
          <AdapterPing v-if="live" :name="name" />
        </template>
      </template>
    </v-list-item>
</template>

<style scoped>
.load-balance--on {
  background: rgba(var(--v-theme-primary), 0.06);
}
/* Shows the state only: the row takes the click. */
.state-only {
  pointer-events: none;
}

/* Opened from a tip's Set up: a pulse of the theme color. */
.internets-highlight {
  animation: internets-pulse 0.8s ease-in-out 3;
}
@keyframes internets-pulse {
  50% {
    background: rgba(var(--v-theme-primary), 0.22);
  }
}
</style>
