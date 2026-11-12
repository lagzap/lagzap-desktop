<script setup lang="ts">
import { useLocale } from "vuetify";
import AdapterPing from "~/components/network/AdapterPing.vue";
import { localDigits } from "~/utils/localeFormat";

// Split Tunnel (one adapter, radios) or Multi Internet (several adapters,
// checkboxes): a checkbox; while it is on, the adapters are listed under it
// with their ping. Turning it on starts on what is in use now.
const props = defineProps<{
  /** Multi Internet: several adapters together. */
  multi?: boolean;
  on: boolean;
  /** Multi Internet: not set on this profile, but already on in the Multi
   * Internet settings (more than one internet), so it applies here too. */
  inherited?: boolean;
  /** Adapters picked (one for Split Tunnel). */
  selected: string[];
  adapters: string[];
  missing: string[];
  loading: boolean;
  disabled?: boolean;
  /** The menu is open: only then the adapter pings stream. */
  live?: boolean;
  icon: (name: string) => string;
}>();
const emit = defineEmits<{
  toggle: [];
  pick: [name: string];
  refresh: [];
}>();
const { t } = useLocale();

const isPicked = (name: string) => props.selected.includes(name);
/** Multi Internet keeps at least two: the last two cannot be unticked. */
const isLocked = (name: string) => !!props.multi && isPicked(name) && props.selected.length <= 2;
// The whole row is the click target; the checkbox/radio only shows the state
// (clicking it alone flipped it on screen even when nothing changed).
const lockedHint = ref("");
let hintTimer: ReturnType<typeof setTimeout> | undefined;
function onPick(name: string) {
  if (isLocked(name)) {
    lockedHint.value = name;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (lockedHint.value = ""), 3000);
    return;
  }
  emit("pick", name);
}
onBeforeUnmount(() => clearTimeout(hintTimer));
/** The adapters are listed while it is on, or on through the settings. */
const open = computed(() => props.on || !!props.inherited);
const anyMissing = computed(() => props.selected.some((name) => props.missing.includes(name)));
const summary = computed(() =>
  props.multi
    ? t("$vuetify.title.profile.server.multiInternetCount", localDigits(props.selected.length))
    : t("$vuetify.title.profile.server.directVia", props.selected[0] ?? ""),
);
const label = computed(() =>
  props.multi ? t("$vuetify.title.profile.multiInternet") : t("$vuetify.title.profile.server.direct"),
);
</script>

<template>
  <v-list-item
    :class="['split-tunnel', { 'split-tunnel--on': on }]"
    :disabled="disabled"
    @click="emit('toggle')"
  >
    <template #prepend>
      <v-checkbox-btn
        class="me-2 state-only"
        density="compact"
        color="primary"
        :model-value="on"
        :indeterminate="!on && inherited"
      />
    </template>
    <template #title>
      <v-avatar size="24" rounded="0">
        <v-icon :color="on ? 'primary' : undefined">mdi-call-split</v-icon>
      </v-avatar>
      <span class="text-caption ms-2">
        {{ label }}
      </span>
    </template>
    <template #append>
      <span v-if="on" class="text-caption d-flex align-center" :class="anyMissing ? 'text-warning' : 'text-primary'">
        <v-icon size="14" class="me-1">{{ anyMissing ? "mdi-alert-outline" : "mdi-check" }}</v-icon>
        {{ summary }}
      </span>
      <span v-else-if="inherited" class="text-caption text-primary d-flex align-center">
        <v-icon size="14" class="me-1">mdi-check</v-icon>
        {{ t("$vuetify.title.profile.server.multiInternetFromSettings", localDigits(selected.length)) }}
      </span>
      <span v-else class="text-caption text-medium-emphasis">
        {{ multi ? t("$vuetify.title.profile.server.multiInternetOff") : t("$vuetify.title.profile.server.splitTunnelOff") }}
      </span>
      <v-btn
        v-if="open"
        icon
        size="x-small"
        variant="text"
        density="comfortable"
        class="ms-1"
        :loading="loading"
        :title="t('$vuetify.title.profile.server.directRefresh')"
        @click.stop="emit('refresh')"
      >
        <v-icon size="14">mdi-refresh</v-icon>
      </v-btn>
    </template>
  </v-list-item>
  <template v-if="open">
    <v-list-item
      v-for="name in adapters"
      :key="name"
      density="compact"
      class="ms-8"
      :disabled="disabled"
      @click="onPick(name)"
    >
      <template #prepend>
        <v-checkbox-btn
          v-if="multi"
          class="me-2 state-only"
          density="compact"
          :color="missing.includes(name) ? 'warning' : 'primary'"
          :model-value="isPicked(name)"
        />
        <v-radio
          v-else
          hide-details
          class="me-2 state-only"
          density="compact"
          :color="missing.includes(name) ? 'warning' : 'primary'"
          :model-value="isPicked(name)"
        />
      </template>
      <template #title>
        <v-icon size="16" class="me-2" :class="{ 'text-medium-emphasis': !isPicked(name) }">{{ icon(name) }}</v-icon>
        <span class="text-caption" :class="{ 'text-medium-emphasis': !isPicked(name) }">{{ name }}</span>
      </template>
      <template #append>
        <span v-if="lockedHint === name" class="text-caption text-warning locked-hint">
          {{ t("$vuetify.title.profile.server.multiInternetMinTwoShort") }}
        </span>
        <span v-else-if="missing.includes(name)" class="text-caption text-warning">
          {{ t("$vuetify.title.profile.server.adapterGone") }}
        </span>
        <AdapterPing v-else-if="live" :name="name" />
      </template>
    </v-list-item>
  </template>
</template>

<style scoped>
/* Shows the state only: the row takes the click. */
.state-only {
  pointer-events: none;
}
.locked-hint {
  max-width: 220px;
  text-align: end;
  line-height: 1.2;
}
/* Tinted while it is on. */
.split-tunnel--on {
  background: rgba(var(--v-theme-primary), 0.06);
}
</style>
