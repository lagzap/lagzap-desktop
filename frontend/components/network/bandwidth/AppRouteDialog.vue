<script setup lang="ts">
import { Dialogs } from "@wailsio/runtime";
import { useLocale } from "vuetify";
import SensitiveText from "~/components/common/SensitiveText.vue";
import type { AppRoute } from "~/utils/indexedDB";

/** Sends an app (exe) or every app in a folder through another internet.
 * Go moves their new connections on the NDIS layer; open ones stay. */
const props = defineProps<{
  /** The app's exe path (from a row), or "" to pick one. */
  path: string;
  name: string;
  /** The rule being edited, or null for a new one. */
  route: AppRoute | null;
}>();
const emit = defineEmits<{ save: [AppRoute]; remove: [string] }>();
const open = defineModel<boolean>({ default: false });

const { t } = useLocale();
const bc = (key: string, ...params: unknown[]) => t(`$vuetify.bandwidthControl.${key}`, ...params);
const store = useStore();

type Kind = "exe" | "folder";
const kind = ref<Kind>("exe");
const exePath = ref("");
const folderPath = ref("");
const internet = ref<string | null>(null);

const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, "");

/** The internets Multi Internet knows, by the name Windows gives them. */
const internets = computed(() => [...new Set(store.interfaces.map((iface) => iface.Name).filter(Boolean))]);

const title = computed(() => (props.name ? bc("internetTitle", props.name) : bc("useInternet")));

watch(open, (shown) => {
  if (!shown) return;
  if (props.route) {
    kind.value = props.route.kind === "folder" ? "folder" : "exe";
    exePath.value = props.route.kind === "folder" ? "" : props.route.path;
    folderPath.value = props.route.kind === "folder" ? props.route.path : folderOf(props.route.path);
    internet.value = props.route.interface;
  } else {
    kind.value = "exe";
    exePath.value = props.path;
    folderPath.value = props.path ? folderOf(props.path) : "";
    internet.value = null;
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

const chosenPath = computed(() => (kind.value === "folder" ? folderPath.value : exePath.value));
const canSave = computed(() => !!internet.value && !!chosenPath.value);

function save() {
  if (!canSave.value) return;
  emit("save", {
    id: props.route?.id ?? crypto.randomUUID(),
    kind: kind.value,
    path: chosenPath.value,
    interface: internet.value!,
    enabled: props.route?.enabled ?? true,
  });
  open.value = false;
}

function remove() {
  if (props.route) emit("remove", props.route.id);
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
        <v-select
          v-model="internet"
          :items="internets"
          :label="bc('internet')"
          :no-data-text="bc('noInternets')"
          prepend-inner-icon="mdi-swap-horizontal"
          density="compact"
          variant="outlined"
          hide-details="auto"
        />

        <div>
          <div class="text-caption text-medium-emphasis mb-1">
            {{ bc("applyTo") }}
          </div>
          <v-radio-group
            v-model="kind"
            density="compact"
            hide-details>
            <div class="route-target">
              <v-radio
                value="exe"
                :label="bc('thisApp')" />
              <div class="route-target__path">
                <span class="text-caption text-medium-emphasis text-truncate">
                  <SensitiveText
                    v-if="exePath"
                    :text="exePath" />
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
                  <SensitiveText
                    v-if="folderPath"
                    :text="folderPath" />
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
          </v-radio-group>
        </div>

        <div class="text-caption text-medium-emphasis">
          {{ bc("internetHint") }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-btn
          v-if="route"
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
