<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useLocale } from "vuetify";
import CountryFlag from "vue-country-flag-next";
import {
  AddProfileWireGuard,
  PingWireGuardConfigs,
  RemoveWireGuardConfig,
  SelectProfileWireGuard,
  SetProfileWireGuardEnabled,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { localDigits } from "~/utils/localeFormat";
import { useNodeLocationLabel } from "~/composables/useNodeLocationLabel";
import { useProfileWireGuard, type WireGuardConfig as Config } from "~/composables/useProfileWireGuard";
import Ping from "~/components/network/Ping.vue";

/** Dedicated IP (WireGuard), under Split tunnel / Load balancing: the traffic
 * goes you -> LagZap relay -> the user's WireGuard -> destination, leaving
 * from the WireGuard server's IP. Collapsed to one row until opened. The
 * saved configs are one list on this PC that every profile picks from; each
 * is dropped or pasted here. */
const props = defineProps<{
  profileId: string;
  disabled?: boolean;
  /** The title picker's Dedicated IP page: no row, the content always
   * shown, and picking a config turns it on (it is a choice there). */
  panel?: boolean;
}>();
const emit = defineEmits<{ picked: [] }>();
// The picker's page has its own Add config button (top right).
defineExpose({ startAdding: () => (adding.value = true) });
const { t } = useLocale();
const store = useStore();
const { getNodeLabel } = useNodeLocationLabel();
const { summary, status, selected, reload: load } = useProfileWireGuard(props.profileId);

const expanded = ref(!!props.panel);
if (props.panel) void load();
const adding = ref(false);
const text = ref("");
const fileName = ref("");
const saveError = ref("");
const saving = ref(false);
const dragging = ref(false);

const hasConfigs = computed(() => summary.value.configs.length > 0);
const on = computed(() => hasConfigs.value && summary.value.enabled);
const showInput = computed(() => !hasConfigs.value || adding.value);

/** Ticks the "handshake ago" text along. */
const now = ref(Date.now());
let clock: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 5000);
});
onUnmounted(() => clearInterval(clock));
// Opened: the list as saved now (another profile may have added one).
watch(expanded, (open) => open && void load());

/** Each config's ping (ms, 0: no answer), measured while the list shows. */
const pings = ref<Record<string, number>>({});
async function measurePings() {
  try {
    pings.value = (await PingWireGuardConfigs()) ?? {};
  } catch {
    // service not running
  }
}
let pingTimer: ReturnType<typeof setInterval> | undefined;
watch(
  expanded,
  (open) => {
    clearInterval(pingTimer);
    if (!open) return;
    void measurePings();
    pingTimer = setInterval(measurePings, 10000);
  },
  { immediate: true },
);
onUnmounted(() => clearInterval(pingTimer));
watch(() => summary.value.configs.length, () => expanded.value && void measurePings());

function errorText(err: unknown): string {
  return String((err as Error)?.message ?? err);
}

async function save() {
  saveError.value = "";
  saving.value = true;
  try {
    await AddProfileWireGuard(props.profileId, fileName.value, text.value);
    await load();
    text.value = "";
    fileName.value = "";
    adding.value = false;
  } catch (err) {
    saveError.value = errorText(err);
  } finally {
    saving.value = false;
  }
}

async function toggle() {
  if (props.disabled) return;
  if (!hasConfigs.value) {
    expanded.value = true;
    return;
  }
  const enabled = !summary.value.enabled;
  try {
    await SetProfileWireGuardEnabled(props.profileId, enabled);
    summary.value = { ...summary.value, enabled };
  } catch (err) {
    saveError.value = errorText(err);
  }
}

async function select(id: string) {
  if (id === summary.value.selected && (summary.value.enabled || props.panel)) {
    if (props.panel) emit("picked");
    return;
  }
  try {
    await SelectProfileWireGuard(props.profileId, id);
    // The picker's page: picking one is choosing Dedicated IP (on Apply).
    if (props.panel) emit("picked");
  } catch (err) {
    saveError.value = errorText(err);
  }
  await load();
}

/** Deleting a saved config turns Dedicated IP off on every profile using
 * it; one used elsewhere asks once (a second click) before going. */
const confirmRemove = ref("");
async function remove(config: Config) {
  const elsewhere = config.profiles.some((id) => id !== props.profileId);
  if (elsewhere && confirmRemove.value !== config.id) {
    confirmRemove.value = config.id;
    return;
  }
  confirmRemove.value = "";
  try {
    await RemoveWireGuardConfig(config.id);
  } catch (err) {
    saveError.value = errorText(err);
  }
  await load();
}

/** The app or game a profile belongs to, by name (World of Warcraft, not
 * its profile's name). */
function titleName(profileId: string): string {
  const profile = store.profiles.find((p) => p.id === profileId);
  const title = profile && store.titles.find((x) => x.id === profile.title_id);
  return title ? (store.localized(title.name) as string) : "";
}

/** The other apps and games using a config. */
function usedElsewhere(config: Config): string {
  const names = config.profiles.filter((id) => id !== props.profileId).map(titleName).filter(Boolean);
  return [...new Set(names)].join(", ");
}

/** Another profile sharing the tunnel picks its relay with its own region
 * choice (one tunnel per config): which one, by its app's name. */
const ownerName = computed(() => {
  const owner = status.value.owner;
  if (!owner || owner === props.profileId || owner.startsWith("app:")) return "";
  return titleName(owner);
});

async function onDrop(event: DragEvent) {
  dragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) {
    fileName.value = file.name;
    text.value = await file.text();
    await save();
    return;
  }
  const dropped = event.dataTransfer?.getData("text/plain");
  if (dropped) text.value = dropped;
}

/** The row's chip: works, or what is wrong, at a glance. */
const chip = computed(() => {
  if (!hasConfigs.value) return { color: undefined, text: t("$vuetify.title.profile.wireguard.notSet") };
  if (!summary.value.enabled) return { color: undefined, text: t("$vuetify.title.profile.wireguard.off") };
  switch (status.value.state) {
    case "working":
      return {
        color: "success",
        text: status.value.ping
          ? t("$vuetify.title.profile.wireguard.workingPing", localDigits(status.value.ping))
          : t("$vuetify.title.profile.wireguard.working"),
      };
    case "connecting":
      return { color: "info", text: t("$vuetify.title.profile.wireguard.connecting") };
    case "no_internet":
      return { color: "warning", text: t("$vuetify.title.profile.wireguard.noInternet") };
    case "failed":
      return { color: "error", text: t("$vuetify.title.profile.wireguard.failed") };
    default:
      // On, but the profile is not in use: the tunnel starts with it.
      return { color: undefined, text: t("$vuetify.title.profile.wireguard.idle") };
  }
});

/** The relay by its city and number (Amsterdam 01), as everywhere else. */
const relayName = computed(() => {
  const node = store.nodes?.[status.value.relay];
  return node ? getNodeLabel(node) : "";
});

const handshakeAgo = computed(() => {
  if (!status.value.handshake) return "";
  const secs = Math.max(0, Math.round(now.value / 1000 - status.value.handshake));
  return secs < 60
    ? t("$vuetify.title.profile.wireguard.secondsAgo", localDigits(secs))
    : t("$vuetify.title.profile.wireguard.minutesAgo", localDigits(Math.floor(secs / 60)));
});
</script>

<template>
  <v-list-item v-if="!panel" :class="['wireguard', { 'wireguard--on': on }]" :disabled="disabled" @click="toggle">
    <template #prepend>
      <v-checkbox-btn class="me-2 state-only" density="compact" color="primary" :model-value="on" />
    </template>
    <template #title>
      <v-avatar size="24" rounded="0">
        <v-icon :color="on ? 'primary' : undefined">mdi-tunnel-outline</v-icon>
      </v-avatar>
      <span class="text-caption ms-2">{{ t("$vuetify.title.profile.wireguard.title") }}</span>
    </template>
    <template #append>
      <span v-if="on && selected" class="wireguard__picked text-caption me-2">
        <CountryFlag v-if="selected.country" :country="selected.country" size="small" />
        <span class="text-truncate">{{ selected.name }}</span>
      </span>
      <v-chip size="x-small" variant="tonal" :color="chip.color" class="me-1">{{ chip.text }}</v-chip>
      <v-btn
        icon
        size="x-small"
        variant="text"
        density="comfortable"
        :aria-label="t('$vuetify.title.profile.wireguard.details')"
        @click.stop="expanded = !expanded"
      >
        <v-icon size="16">{{ expanded ? "mdi-chevron-up" : "mdi-chevron-down" }}</v-icon>
      </v-btn>
    </template>
  </v-list-item>

  <v-expand-transition>
    <div v-if="expanded" class="wireguard__body" :class="{ 'wireguard__body--panel': panel }">
      <div class="text-caption text-medium-emphasis mb-2">{{ t("$vuetify.title.profile.wireguard.about") }}</div>

      <!-- The configs kept; the picked one is used -->
      <div v-if="hasConfigs" class="wireguard__list">
        <div
          v-for="config in summary.configs"
          :key="config.id"
          class="wireguard__config"
          :class="{ 'wireguard__config--picked': config.id === summary.selected }"
          @click="select(config.id)"
        >
          <v-radio
            hide-details
            density="compact"
            color="primary"
            class="state-only flex-grow-0"
            :model-value="config.id === summary.selected"
          />
          <CountryFlag v-if="config.country" :country="config.country" size="small" />
          <v-icon v-else size="16" class="text-medium-emphasis">mdi-earth</v-icon>
          <div class="d-flex flex-column min-w-0 flex-grow-1">
            <span class="text-caption font-weight-medium text-truncate">{{ config.name }}</span>
            <span class="text-caption text-medium-emphasis text-truncate" dir="ltr">{{ config.ip }}</span>
            <span v-if="usedElsewhere(config)" class="text-caption text-medium-emphasis text-truncate">
              {{ t("$vuetify.title.profile.wireguard.alsoUsedBy", usedElsewhere(config)) }}
            </span>
          </div>
          <!-- The one in use: whether it works; every one: its ping. -->
          <v-chip
            v-if="on && config.id === summary.selected"
            size="x-small"
            variant="tonal"
            :color="chip.color"
            class="flex-shrink-0"
          >
            {{ chip.text }}
          </v-chip>
          <Ping v-if="pings[config.id]" :latency-ms="pings[config.id]" class="flex-shrink-0" />
          <span v-else-if="config.id in pings" class="text-caption text-medium-emphasis flex-shrink-0">—</span>
          <v-btn
            :icon="confirmRemove === config.id ? 'mdi-delete-alert-outline' : 'mdi-delete-outline'"
            size="x-small"
            variant="text"
            density="comfortable"
            :color="confirmRemove === config.id ? 'error' : undefined"
            v-tooltip="confirmRemove === config.id ? t('$vuetify.title.profile.wireguard.removeEverywhere') : t('$vuetify.title.profile.wireguard.remove')"
            :aria-label="t('$vuetify.title.profile.wireguard.remove')"
            @click.stop="remove(config)"
          />
        </div>
      </div>

      <!-- Whether the picked one works: its relay, handshake and ping. -->
      <div v-if="on && selected" class="wireguard__facts mt-3">
        <div v-if="status.direct || relayName" class="wireguard__fact">
          <span class="wireguard__fact-label">{{ t("$vuetify.title.profile.wireguard.relay") }}</span>
          <span class="wireguard__fact-value">{{ status.direct ? t("$vuetify.title.profile.wireguard.relayDirect") : relayName }}</span>
        </div>
        <div v-if="handshakeAgo" class="wireguard__fact">
          <span class="wireguard__fact-label">{{ t("$vuetify.title.profile.wireguard.handshake") }}</span>
          <span class="wireguard__fact-value">{{ handshakeAgo }}</span>
        </div>
        <div v-if="status.state === 'working' && status.ping" class="wireguard__fact">
          <span class="wireguard__fact-label">{{ t("$vuetify.title.profile.wireguard.ping") }}</span>
          <span class="wireguard__fact-value"><Ping :latency-ms="status.ping" /></span>
        </div>
      </div>
      <div v-if="on && selected && ownerName" class="text-caption text-medium-emphasis mt-2">
        {{ t("$vuetify.title.profile.wireguard.ownerNote", ownerName) }}
      </div>
      <div v-if="on && selected && status.error" class="text-caption text-error mt-2">{{ status.error }}</div>

      <v-btn
        v-if="hasConfigs && !adding && !panel"
        size="small"
        variant="tonal"
        prepend-icon="mdi-plus"
        class="mt-2"
        @click="adding = true"
      >
        {{ t("$vuetify.title.profile.wireguard.add") }}
      </v-btn>

      <!-- Drop a .conf file or paste a config -->
      <div
        v-if="showInput"
        class="wireguard__drop mt-2"
        :class="{ 'wireguard__drop--over': dragging }"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <v-textarea
          v-model="text"
          :placeholder="t('$vuetify.title.profile.wireguard.paste')"
          variant="outlined"
          density="compact"
          rows="4"
          auto-grow
          hide-details
          spellcheck="false"
          class="wireguard__text"
        />
        <div class="d-flex align-center ga-2 mt-2">
          <span class="text-caption text-medium-emphasis flex-grow-1">{{ t("$vuetify.title.profile.wireguard.dropHint") }}</span>
          <v-btn v-if="adding" size="small" variant="text" @click="adding = false">
            {{ t("$vuetify.title.profile.wireguard.cancel") }}
          </v-btn>
          <v-btn size="small" color="primary" variant="flat" :loading="saving" :disabled="!text.trim()" @click="save">
            {{ t("$vuetify.title.profile.wireguard.save") }}
          </v-btn>
        </div>
      </div>
      <div v-if="saveError" class="text-caption text-error mt-1">{{ saveError }}</div>
      <!-- Where the config goes: said while one is being added. -->
      <div v-if="showInput" class="text-caption text-medium-emphasis mt-2">
        <v-icon size="14" class="me-1">mdi-shield-lock-outline</v-icon>{{ t("$vuetify.title.profile.wireguard.private") }}
      </div>
    </div>
  </v-expand-transition>
</template>

<style scoped>
.state-only {
  pointer-events: none;
}
.wireguard--on {
  background: rgba(var(--v-theme-primary), 0.06);
}
.wireguard__picked {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 140px;
}
.wireguard__body {
  padding: 4px 16px 12px 48px;
}
.wireguard__body--panel {
  padding: 0;
}
.wireguard__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.wireguard__config {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid transparent;
}
.wireguard__config:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.wireguard__config--picked {
  border-color: rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.06);
}
.wireguard__facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}
.wireguard__fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(var(--v-theme-on-surface), 0.04);
}
.wireguard__fact-label {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.wireguard__fact-value {
  font-size: 0.9375rem;
  font-weight: 500;
}
.wireguard__drop {
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.25);
  border-radius: 8px;
  padding: 8px;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.wireguard__drop--over {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}
.wireguard__text :deep(textarea) {
  font-family: ui-monospace, monospace;
  font-size: 0.75rem;
}
</style>
