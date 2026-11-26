<script setup lang="ts">
import { useLocale } from "vuetify";
import AdapterPing from "~/components/network/AdapterPing.vue";
import InternetCard from "~/components/title/InternetCard.vue";
import InternetRow from "~/components/title/InternetRow.vue";
import { adapterIcon } from "~/utils/adapterIcon";
import { useNetworkAdapterSettings } from "~/composables/useNetworkAdapterSettings";
import { useStore } from "@/stores";

// A Prevent disconnect profile's internets, as a card (InternetCard): its
// main internet and the backups it moves to when that one drops, in order.
//   - Checkbox indeterminate: not set here, it follows the settings (Network
//     Adapter's Default, then Backup Interfaces) — dashed, said in one line.
//   - Ticked: its own order. The ticked rows are used top to bottom: the first
//     is the main internet (default_interface), the rest its backups
//     (network_interfaces). Drag a row to move it; untick to leave it out.
//     With no backup ticked it keeps the main one only ("-"); with none
//     ticked at all, the Default internet only.
// One ticked but not connected now is in the warning color, with Remove.
const props = defineProps<{
  /** The profile's main internet (default_interface), "" when not set. */
  main: string;
  /** The profile's backups (network_interfaces), in order; ["-"] = none. */
  backups: string[];
  /** The internets connected now, in the adapter order. */
  adapters: string[];
  missing: string[];
  down?: string[];
  loading: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  change: [main: string, backups: string[]];
  remove: [name: string];
  refresh: [];
}>();
const { t, current } = useLocale();
const store = useStore();
const { defaultInterfaceOverride, backupInterfaces } = useNetworkAdapterSettings();
const p = (key: string, ...params: unknown[]) => t(`$vuetify.title.profile.${key}`, ...params);

/** "-" in the backups: the main internet only. */
const NO_BACKUPS = "-";
const isName = (name: string) => !!name && name !== NO_BACKUPS && name !== "*";

/** Set on this profile (not following the settings). */
const own = computed(() => !!props.main || props.backups.length > 0);
/** Its own order: main first, then backups, each once. */
const ticked = computed(() => {
  const out: string[] = [];
  for (const name of [props.main, ...props.backups]) if (isName(name) && !out.includes(name)) out.push(name);
  return out;
});

/** What the settings use: their Default (else Windows'), then their backups. */
const settingsMain = computed(() => defaultInterfaceOverride.value || store.defaultInterface || "");
const settingsOrder = computed(() => {
  const out: string[] = [];
  for (const name of [settingsMain.value, ...backupInterfaces.selection.value]) {
    if (name && props.adapters.includes(name) && !out.includes(name)) out.push(name);
  }
  return out;
});

const list = (names: string[]) => new Intl.ListFormat(current.value, { type: "conjunction" }).format(names);
/** Main first, then the backups: "ZLT first, then PTP". */
const orderText = (names: string[]) =>
  names.length > 1 ? p("orderThen", names[0], list(names.slice(1))) : p("orderOnly", names[0] ?? "");

/** While dragging: the rows' order on screen. */
const dragOrder = ref<string[] | null>(null);
/** The rows: the ticked ones in order, then the other connected ones. */
const rows = computed(
  () => dragOrder.value ?? [...ticked.value, ...props.adapters.filter((name) => !ticked.value.includes(name))],
);
const isMissing = (name: string) => props.missing.includes(name) || !props.adapters.includes(name);
const isDown = (name: string) => !isMissing(name) && !!props.down?.includes(name);

/** Saves an order: its first is the main internet, the rest its backups. */
function save(order: string[]) {
  const [main = "", ...rest] = order;
  emit("change", main, rest.length > 0 ? rest : [NO_BACKUPS]);
}
/** Follows the settings ⇄ its own order (starting from what is in use). */
function toggle() {
  if (own.value) emit("change", "", []);
  else save(settingsOrder.value.length > 0 ? settingsOrder.value : props.adapters.slice(0, 1));
}
function pick(name: string) {
  save(ticked.value.includes(name) ? ticked.value.filter((n) => n !== name) : [...ticked.value, name]);
}

/** Drag and drop: while a row is dragged, its copy follows the pointer and
 * the rows make room under it (dragOrder); let go, the order is saved. The
 * dragged row is ticked. Pointer events, not HTML drag and drop (which the
 * app's window does not pass to the page), like the sidebar's favorites. */
const dragging = ref("");
const ghost = ref<{ name: string; x: number; y: number; width: number; height: number } | null>(null);
let grab = { x: 0, y: 0 };
/** The row under the pointer, from its data-row (the copy lets it through). */
function rowAt(x: number, y: number): string {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  return el?.closest<HTMLElement>("[data-row]")?.dataset.row ?? "";
}
function onMove(event: PointerEvent) {
  const g = ghost.value;
  if (!g || !dragOrder.value) return;
  ghost.value = { ...g, x: event.clientX - grab.x, y: event.clientY - grab.y };
  const target = rowAt(event.clientX, event.clientY);
  if (!target || target === dragging.value) return;
  const order = dragOrder.value.filter((name) => name !== dragging.value);
  const at = order.indexOf(target);
  // Past the middle of a row going down puts it after; else before.
  const from = dragOrder.value.indexOf(dragging.value);
  order.splice(at < 0 ? order.length : from <= at ? at + 1 : at, 0, dragging.value);
  dragOrder.value = order;
}
function stopListening() {
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onCancel);
  document.body.classList.remove("backup-internets-sorting");
}
function onUp() {
  stopListening();
  const order = dragOrder.value;
  const moved = dragging.value;
  dragging.value = "";
  ghost.value = null;
  dragOrder.value = null;
  if (!order || !moved) return;
  const keep = new Set([...ticked.value, moved]);
  const next = order.filter((name) => keep.has(name));
  if (next.join("|") !== ticked.value.join("|")) save(next);
}
function onCancel() {
  stopListening();
  dragging.value = "";
  ghost.value = null;
  dragOrder.value = null;
}
function startDrag(name: string, event: PointerEvent) {
  if (props.disabled || event.button !== 0) return;
  const row = (event.target as HTMLElement).closest<HTMLElement>("[data-row]");
  const rect = row?.getBoundingClientRect();
  if (!rect) return;
  grab = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  dragOrder.value = [...rows.value];
  dragging.value = name;
  ghost.value = { name, x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  document.body.classList.add("backup-internets-sorting");
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
}
onBeforeUnmount(stopListening);
</script>

<template>
  <InternetCard
    settings-link
    :on="own"
    :title="p('backupInternetsTitle')"
    icon="mdi-swap-vertical-bold"
    :disabled="disabled"
    :checked="own"
    :indeterminate="!own"
    :refresh="own"
    :loading="loading"
    @toggle="toggle"
    @refresh="emit('refresh')"
  >
    <template #state>
      <span
        v-if="own && ticked.length === 0"
        class="text-primary">
        {{ p("orderDefaultOnly", store.defaultInterface || p("server.loadBalanceDefaultInternet")) }}
      </span>
      <span
        v-else-if="own"
        class="text-primary">
        {{ orderText(ticked) }}
      </span>
      <span
        v-else-if="settingsOrder.length"
        class="text-medium-emphasis">
        {{ p("orderFromSettings", orderText(settingsOrder)) }}
      </span>
      <span
        v-else
        class="text-medium-emphasis">
        {{ p("server.automaticSelection") }}
      </span>
    </template>
    <template
      v-if="own"
      #default>
      <TransitionGroup
        name="backup-internets-move"
        tag="div"
        class="backup-internets__list">
        <div
          v-for="name in rows"
          :key="name"
          :class="[
            'backup-internets__row',
            {
              'backup-internets__row--dragging': dragging === name,
            },
          ]"
          :data-row="name"
        >
          <InternetRow
            :name="name"
            :icon="adapterIcon(name)"
            :picked="ticked.includes(name)"
            :missing="isMissing(name) || isDown(name)"
            :missing-text="isDown(name) ? p('server.noInternetShort') : undefined"
            :disabled="disabled"
            @pick="isMissing(name) ? emit('remove', name) : pick(name)"
          >
            <template #prepend>
              <v-icon
                v-tooltip="p('dragToOrder')"
                size="18"
                class="backup-internets__handle"
                icon="mdi-drag-vertical"
                @click.stop
                @pointerdown.stop.prevent="startDrag(name, $event)"
              />
            </template>
            <template #append>
              <v-chip
                v-if="ticked.includes(name)"
                size="x-small"
                variant="tonal"
                :color="ticked[0] === name ? 'primary' : undefined"
              >
                {{ ticked[0] === name ? p("roleMain") : p("roleBackup") }}
              </v-chip>
              <v-btn
                v-if="isMissing(name)"
                size="x-small"
                variant="tonal"
                color="warning"
                class="text-none"
                :disabled="disabled"
                @click.stop="emit('remove', name)"
              >
                {{ p("server.removeInternet") }}
              </v-btn>
              <AdapterPing
                v-else-if="!isDown(name)"
                :name="name" />
            </template>
          </InternetRow>
        </div>
      </TransitionGroup>
      <!-- The dragged row's copy, under the pointer. -->
      <Teleport to="body">
        <div
          v-if="ghost"
          class="backup-internets__ghost"
          :style="{ left: `${ghost.x}px`, top: `${ghost.y}px`, width: `${ghost.width}px`, height: `${ghost.height}px` }"
        >
          <v-icon
            size="18"
            icon="mdi-drag-vertical"
            class="me-2" />
          <v-icon
            size="16"
            :icon="adapterIcon(ghost.name)"
            class="me-2" />
          <span class="text-caption">
            {{ ghost.name }}
          </span>
        </div>
      </Teleport>
    </template>
  </InternetCard>
</template>

<style scoped>
.backup-internets__row {
  border-radius: 8px;
  transition: box-shadow 0.12s;
}
.backup-internets__list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* Rows making room slide into place. */
.backup-internets-move-move {
  transition: transform 0.15s ease;
}
/* Where the dragged row will land: an empty slot. */
.backup-internets__row--dragging {
  opacity: 0.25;
  outline: 1px dashed rgba(var(--v-theme-primary), 0.6);
}
.backup-internets__handle {
  cursor: grab;
  opacity: 0.5;
  margin-inline-start: 2px;
  touch-action: none;
}
</style>

<style>
/* The dragged row's copy: follows the pointer, above the menu. */
.backup-internets__ghost {
  position: fixed;
  z-index: 30000;
  display: flex;
  align-items: center;
  padding: 0 10px 0 6px;
  border-radius: 8px;
  pointer-events: none;
  background: rgb(var(--v-theme-surface-bright, var(--v-theme-surface)));
  border: 1px solid rgba(var(--v-theme-primary), 0.6);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  transform: scale(1.02);
}
/* While a row is moved: a grabbing hand everywhere, no text selected. */
body.backup-internets-sorting,
body.backup-internets-sorting * {
  cursor: grabbing !important;
  user-select: none !important;
}
</style>
