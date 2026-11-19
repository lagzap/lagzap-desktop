<script setup lang="ts">
import { Dialogs } from "@wailsio/runtime";
import { useLocale } from "vuetify";
import CountryFlag from "vue-country-flag-next";
import { GetProfileWireGuard } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { WireGuardConfig } from "~/composables/useProfileWireGuard";
import type { AppTunnel } from "~/utils/indexedDB";

/** Sends an app (exe), every app in a folder, or the whole PC through a
 * saved Dedicated IP (WireGuard) config. Go captures them and routes their
 * new connections into the config's tunnel; their speed caps still apply. */
const props = defineProps<{
  /** The app's exe path (from a row), or "" to pick one. */
  path: string;
  name: string;
  /** The rule being edited, or null for a new one. */
  tunnel: AppTunnel | null;
  /** Start on the whole PC. */
  wholePc?: boolean;
}>();
const emit = defineEmits<{ save: [AppTunnel]; remove: [string] }>();
const open = defineModel<boolean>({ default: false });

const { t } = useLocale();
const bc = (key: string, ...params: unknown[]) => t(`$vuetify.bandwidthControl.${key}`, ...params);

type Kind = "exe" | "folder" | "pc";
const kind = ref<Kind>("exe");
const exePath = ref("");
const folderPath = ref("");
const configId = ref<string | null>(null);
/** The saved configs: one list on this PC, shared with the profiles. */
const configs = ref<WireGuardConfig[]>([]);

const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, "");

const title = computed(() => (props.name ? bc("dedicatedIpTitle", props.name) : bc("useDedicatedIp")));

watch(open, async (shown) => {
  if (!shown) return;
  try {
    const summary = (await GetProfileWireGuard("")) as { configs?: WireGuardConfig[] };
    configs.value = summary.configs ?? [];
  } catch {
    configs.value = [];
  }
  if (props.tunnel) {
    kind.value = props.tunnel.kind as Kind;
    exePath.value = props.tunnel.kind === "exe" ? props.tunnel.path : "";
    folderPath.value = props.tunnel.kind === "folder" ? props.tunnel.path : props.tunnel.path ? folderOf(props.tunnel.path) : "";
    configId.value = props.tunnel.config_id;
  } else {
    kind.value = props.wholePc ? "pc" : "exe";
    exePath.value = props.path;
    folderPath.value = props.path ? folderOf(props.path) : "";
    configId.value = configs.value[0]?.id ?? null;
  }
});

async function browseExe() {
  try {
    const picked = await Dialogs.OpenFile({
      Title: bc("pickAppInternet"),
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
      Title: bc("pickFolderInternet"),
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

const chosenPath = computed(() => (kind.value === "folder" ? folderPath.value : kind.value === "exe" ? exePath.value : ""));
const canSave = computed(() => !!configId.value && (kind.value === "pc" || !!chosenPath.value));

function save() {
  if (!canSave.value) return;
  emit("save", {
    id: props.tunnel?.id ?? crypto.randomUUID(),
    kind: kind.value,
    path: chosenPath.value,
    config_id: configId.value!,
    enabled: props.tunnel?.enabled ?? true,
  });
  open.value = false;
}

function remove() {
  if (props.tunnel) emit("remove", props.tunnel.id);
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
        <div v-if="!configs.length" class="text-body-2 text-medium-emphasis">
          {{ bc("noDedicatedIps") }}
        </div>
        <v-radio-group
          v-else
          v-model="configId"
          hide-details>
          <v-radio
            v-for="config in configs"
            :key="config.id"
            :value="config.id">
            <template #label>
              <span class="d-flex align-center ga-2 min-w-0">
                <CountryFlag v-if="config.country" :country="config.country" size="small" />
                <span class="text-body-2 text-truncate">{{ config.name }}</span>
                <span class="text-caption text-medium-emphasis" dir="ltr">{{ config.ip }}</span>
              </span>
            </template>
          </v-radio>
        </v-radio-group>

        <div>
          <div class="text-caption text-medium-emphasis mb-1">
            {{ bc("applyTo") }}
          </div>
          <v-radio-group
            v-model="kind"
            hide-details>
            <div class="route-target">
              <v-radio
                value="exe"
                :label="bc('thisApp')" />
              <div class="route-target__path">
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
            <div class="route-target">
              <v-radio
                value="folder"
                :label="bc('thisFolder')" />
              <div class="route-target__path">
                <span class="text-caption text-medium-emphasis text-truncate">
                  <span v-if="folderPath" dir="ltr">{{ folderPath }}</span>
                  <template v-else>
                    {{ bc("nothingPicked") }}
                  </template>
                </span>
                <v-btn
                  size="small"
                  variant="text"
                  prepend-icon="mdi-folder-search-outline"
                  @click="browseFolder">
                  {{ bc("browse") }}
                </v-btn>
              </div>
            </div>
            <v-radio
              value="pc"
              :label="bc('wholePc')" />
          </v-radio-group>
        </div>

        <div class="text-caption text-medium-emphasis">
          {{ bc("dedicatedIpHint") }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-btn
          v-if="tunnel"
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
          :disabled="!canSave"
          @click="save">
          {{ bc("save") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.route-target__path {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding-inline-start: 40px;
}
</style>
