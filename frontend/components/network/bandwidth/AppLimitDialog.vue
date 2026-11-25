<script setup lang="ts">
import { Dialogs } from "@wailsio/runtime";
import { useLocale } from "vuetify";
import { speedUnit } from "~/utils/localeFormat";
import PillToggle from "~/components/common/PillToggle.vue";
import { untilText } from "~/components/network/bandwidth/until";
import type { AppLimit } from "~/utils/indexedDB";

/** Sets or edits one speed cap: for an app (exe), for every app in a folder,
 * for the whole PC, for every high-traffic profile LagZap routes, or for one
 * routed profile. The exe and the folder can be picked from disk, so an app
 * that is not in the list yet can be capped too. A cap can be kept, or end
 * after a while or when LagZap closes. */
const props = defineProps<{
  /** The app's exe path (from a row) — or the rule being edited; "" to pick
   * one. */
  path: string;
  name: string;
  limit: AppLimit | null;
  /** The app's speed now, to suggest a cap. */
  speed?: number;
  /** A cap of a fixed kind: the whole PC, every high-traffic profile (path
   * unused), or one routed profile (path is its id). */
  fixed?: "pc" | "high_traffic" | "profile" | "adapter";
  /** A profile's cap with its three choices on top: the global high-traffic
   * cap (this label), Off, or its own cap. Global removes the profile's rule. */
  globalLabel?: string;
}>();
const emit = defineEmits<{ save: [AppLimit]; remove: [string] }>();
const open = defineModel<boolean>({ default: false });

const { t } = useLocale();
const bc = (key: string, ...params: unknown[]) => t(`$vuetify.bandwidthControl.${key}`, ...params);

const KB = 1024;
const MB = 1024 * 1024;
type Kind = "exe" | "folder" | "pc" | "high_traffic" | "profile" | "adapter";
const kind = ref<Kind>("exe");
/** The cap as typed, in unit (KB/s or MB/s). */
const amount = ref("1");
const unit = ref<1 | 2>(2);
const unitOptions = computed(() => [
  { value: 1, title: speedUnit(1) },
  { value: 2, title: speedUnit(2) },
]);
/** Shows bytes/s in the unit that reads best: KB/s under 1 MB/s. */
function showCap(bytes: number) {
  unit.value = bytes < MB ? 1 : 2;
  amount.value = String(+(bytes / (unit.value === 1 ? KB : MB)).toFixed(2));
}
const onlyWhileGaming = ref(false);
const exePath = ref("");
const folderPath = ref("");

const folderOf = (path: string) => path.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "");
// "C:\Games" goes up to "C:\"; a drive root has no parent.
const parentOf = (path: string) => {
  const parent = folderOf(path);
  return /^[a-z]:$/i.test(parent) ? `${parent}\\` : parent;
};
const canGoUp = computed(() => {
  const parent = parentOf(folderPath.value);
  return !!parent && parent !== folderPath.value;
});

const title = computed(() => {
  if (props.fixed === "pc") return bc("pcCapTitle");
  if (props.fixed === "high_traffic") return bc("highTrafficCapTitle");
  return props.name ? bc("capTitle", props.name) : bc("customCapTitle");
});

const fixedHint = computed(() => {
  if (props.fixed === "pc") return bc("pcShared");
  if (props.fixed === "high_traffic") return bc("highTrafficShared");
  if (props.fixed === "profile") return bc("profileShared");
  if (props.fixed === "adapter") return bc("adapterShared");
  return "";
});

// How long the cap lasts.
type Keep = "always" | "1" | "2" | "4" | "restart" | "current";
const keep = ref<Keep>("always");
const keepOptions = computed(() => {
  const options: { value: Keep; title: string }[] = [
    { value: "always", title: bc("keepAlways") },
    { value: "1", title: bc("keep1h") },
    { value: "2", title: bc("keep2h") },
    { value: "4", title: bc("keep4h") },
    { value: "restart", title: bc("keepRestart") },
  ];
  const ends = props.limit?.expires_at;
  if (ends && ends > Date.now()) options.unshift({ value: "current", title: bc("endsIn", untilText(ends, t)) });
  return options;
});

function keepFields(): Pick<AppLimit, "expires_at" | "until_restart"> {
  switch (keep.value) {
    case "current":
      return { expires_at: props.limit?.expires_at };
    case "restart":
      return { until_restart: true };
    case "always":
      return {};
    default:
      return { expires_at: Date.now() + Number(keep.value) * 3_600_000 };
  }
}

type Choice = "global" | "off" | "own";
const choice = ref<Choice>("own");
const choices = computed(() => [
  { value: "global" as Choice, title: props.globalLabel ?? "", icon: "mdi-earth" },
  { value: "off" as Choice, title: bc("capNever") },
  { value: "own" as Choice, title: bc("capCustom"), icon: "mdi-speedometer-slow" },
]);
const ownCap = computed(() => !props.globalLabel || choice.value === "own");

watch(open, (isOpen) => {
  if (!isOpen) return;
  choice.value = !props.limit ? "global" : props.limit.download <= 0 ? "off" : "own";
  const ends = props.limit?.expires_at;
  keep.value = props.limit?.until_restart ? "restart" : ends && ends > Date.now() ? "current" : "always";
  if (props.fixed) {
    kind.value = props.fixed;
    showCap(props.limit && props.limit.download > 0 ? props.limit.download : 5 * MB);
    // A profile's own cap (set from its card): applies right away unless
    // asked otherwise; the shared high-traffic one keeps waiting for games.
    onlyWhileGaming.value = props.limit?.only_while_gaming ?? props.fixed !== "profile";
    return;
  }
  if (props.limit) {
    kind.value = props.limit.kind === "folder" ? "folder" : "exe";
    exePath.value = props.limit.kind === "folder" ? "" : props.limit.path;
    folderPath.value = props.limit.kind === "folder" ? props.limit.path : folderOf(props.limit.path);
    showCap(props.limit.download);
    onlyWhileGaming.value = props.limit.only_while_gaming;
  } else {
    kind.value = "exe";
    exePath.value = props.path;
    folderPath.value = props.path ? folderOf(props.path) : "";
    showCap(props.speed && props.speed > 2 * MB ? Math.round(props.speed / 2 / MB) * MB : MB);
    onlyWhileGaming.value = true;
  }
});

async function browseExe() {
  try {
    const picked = await Dialogs.OpenFile({
      Title: bc("pickApp"),
      CanChooseFiles: true,
      CanChooseDirectories: false,
      Filters: [{ DisplayName: bc("pickAppFilter"), Pattern: "*.exe" }],
      Directory: exePath.value ? folderOf(exePath.value) : folderPath.value || undefined,
    });
    if (typeof picked === "string" && picked) {
      exePath.value = picked;
      if (!folderPath.value) folderPath.value = folderOf(picked);
      kind.value = "exe";
    }
  } catch {
    // dialog closed
  }
}

async function browseFolder() {
  try {
    const picked = await Dialogs.OpenFile({
      Title: bc("pickFolder"),
      CanChooseFiles: false,
      CanChooseDirectories: true,
      Directory: folderPath.value || undefined,
    });
    if (typeof picked === "string" && picked) {
      folderPath.value = picked;
      kind.value = "folder";
    }
  } catch {
    // dialog closed
  }
}

function goUp() {
  if (!canGoUp.value) return;
  folderPath.value = parentOf(folderPath.value);
  kind.value = "folder";
}

const bytesPerSecond = computed(() => {
  const value = Number(String(amount.value).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace("٫", "."));
  return Number.isFinite(value) && value > 0 ? Math.round(value * (unit.value === 1 ? KB : MB)) : 0;
});

const chosenPath = computed(() => {
  switch (kind.value) {
    case "pc":
    case "high_traffic":
      return "";
    case "profile":
    case "adapter":
      return props.path;
    case "folder":
      return folderPath.value;
    default:
      return exePath.value;
  }
});
const canSave = computed(
  () => !!bytesPerSecond.value && (kind.value === "pc" || kind.value === "high_traffic" || !!chosenPath.value),
);

function save() {
  if (props.globalLabel && choice.value === "global") {
    if (props.limit) emit("remove", props.limit.id);
    open.value = false;
    return;
  }
  if (props.globalLabel && choice.value === "off") {
    emit("save", {
      id: props.limit?.id ?? crypto.randomUUID(),
      kind: "profile",
      path: props.path,
      download: 0,
      only_while_gaming: false,
      enabled: true,
    });
    open.value = false;
    return;
  }
  if (!canSave.value) return;
  emit("save", {
    id: props.limit?.id ?? crypto.randomUUID(),
    kind: kind.value,
    path: chosenPath.value,
    download: bytesPerSecond.value,
    only_while_gaming: onlyWhileGaming.value,
    enabled: props.limit?.enabled ?? true,
    ...keepFields(),
  });
  open.value = false;
}

function remove() {
  if (props.limit) emit("remove", props.limit.id);
  open.value = false;
}
</script>

<template>
  <v-dialog
    v-model="open"
    max-width="480">
    <v-card
      :title="title"
      rounded="lg">
      <v-card-text class="d-flex flex-column ga-3">
        <PillToggle v-if="globalLabel" v-model="choice" :items="choices" />
        <template v-if="ownCap">
        <div class="d-flex align-start ga-2">
          <v-text-field
            v-model="amount"
            :label="bc('capSpeed')"
            :error-messages="bytesPerSecond ? [] : [bc('invalid')]"
            inputmode="decimal"
            density="compact"
            variant="outlined"
            autofocus
            @keydown.enter="save"
          />
          <v-select
            v-model="unit"
            :items="unitOptions"
            :aria-label="bc('capUnit')"
            density="compact"
            variant="outlined"
            hide-details
            class="limit-unit"
          />
        </div>

        <div
          v-if="fixed"
          class="text-caption text-medium-emphasis">
          {{ fixedHint }}
        </div>
        <div v-else>
          <div class="text-caption text-medium-emphasis mb-1">
            {{ bc("applyTo") }}
          </div>
          <v-radio-group
            v-model="kind"
            hide-details>
            <div class="limit-target">
              <v-radio
                value="exe"
                :label="bc('thisApp')" />
              <div class="limit-target__path">
                <span class="text-caption text-medium-emphasis text-truncate">
                  <span v-if="exePath" dir="ltr">{{ exePath }}</span>
                  <template v-else>
                    {{ bc("nothingPicked") }}
                  </template>
                </span>
                <v-btn
                  size="small"
                  variant="text"
                  prepend-icon="mdi-file-search-outline"
                  @click="browseExe">
                  {{ bc("browse") }}
                </v-btn>
              </div>
            </div>
            <div class="limit-target">
              <v-radio
                value="folder"
                :label="bc('thisFolder')" />
              <div class="limit-target__path">
                <span class="text-caption text-medium-emphasis text-truncate">
                  <span v-if="folderPath" dir="ltr">{{ folderPath }}</span>
                  <template v-else>
                    {{ bc("nothingPicked") }}
                  </template>
                </span>
                <v-btn
                  v-if="folderPath"
                  icon="mdi-arrow-up"
                  size="small"
                  variant="text"
                  :disabled="!canGoUp"
                  v-tooltip="bc('folderUp')"
                  :aria-label="bc('folderUp')"
                  @click="goUp"
                />
                <v-btn
                  size="small"
                  variant="text"
                  prepend-icon="mdi-folder-search-outline"
                  @click="browseFolder">
                  {{ bc("browse") }}
                </v-btn>
              </div>
            </div>
          </v-radio-group>
          <div
            v-if="kind === 'folder'"
            class="text-caption text-medium-emphasis mt-1">
            {{ bc("folderShared") }}
          </div>
        </div>

        <div>
          <v-switch
            v-model="onlyWhileGaming"
            :label="bc('onlyWhileGaming')"
            color="primary"
            density="compact"
            hide-details
            inset
          />
          <div class="text-caption text-medium-emphasis">
            {{ bc("onlyWhileGamingHint") }}
          </div>
        </div>

        <v-select
          v-model="keep"
          :items="keepOptions"
          item-value="value"
          item-title="title"
          :label="bc('keep')"
          prepend-inner-icon="mdi-timer-outline"
          density="compact"
          variant="outlined"
          hide-details
        />

        </template>
        <div class="text-caption text-medium-emphasis">
          {{ globalLabel ? bc("highTrafficSettingHint") : bc("never") }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-btn
          v-if="limit && !globalLabel"
          color="error"
          variant="text"
          @click="remove">
          {{ bc("remove") }}
        </v-btn>
        <v-spacer />
        <v-btn
          variant="text"
          @click="open = false">
          {{ bc("cancel") }}
        </v-btn>
        <v-btn
          color="primary"
          variant="tonal"
          :disabled="ownCap && !canSave"
          @click="save">
          {{ bc("save") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.limit-unit {
  flex: 0 0 112px;
}

.limit-target + .limit-target {
  margin-top: 4px;
}

/* The path sits under its radio label, lined up with the label text. */
.limit-target__path {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding-inline-start: 40px;
}

.limit-target__path > span {
  flex: 1 1 auto;
  min-width: 0;
}
</style>
