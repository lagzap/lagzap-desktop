<script setup lang="ts">
import { computed, ref } from "vue";
import { useLocale } from "vuetify";
import TitleAvatar from "~/components/plan/TitleAvatar.vue";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { localDigits } from "~/utils/localeFormat";

/** The plan caps how many apps are active at once. Turning one on at the
 * limit asks here: turn one off (then turn the new one on, one click each),
 * or upgrade. When the limit drops, Go turns the least recently used extras
 * off and this shows one notice. */
const locale = useLocale();
const { t } = locale;
const store = useStore();
const { openUpgrade } = usePlanAccess();

const titleById = (id: string) => store.titles.find((title) => title.id === id);
const nameOf = (id: string) => {
  const title = titleById(id);
  return title ? store.titleName(title.name) : id;
};

/* ----- At the limit ----- */
const open = computed({
  get: () => !!store.titleLimitRequest,
  set: (value: boolean) => {
    if (!value) store.titleLimitRequest = null;
  },
});
const wanted = computed(() => store.titleLimitRequest);
const limit = computed(() => store.activeTitleLimit);
const hasRoom = computed(() => limit.value === 0 || store.activeTitleIds.length < limit.value);
const busy = ref<string | null>(null);

async function turnOff(id: string) {
  busy.value = id;
  try {
    await store.deactivateTitle(id);
  } finally {
    busy.value = null;
  }
}

async function turnOnWanted() {
  const id = wanted.value;
  if (!id) return;
  store.titleLimitRequest = null;
  await store.activateTitle(id);
}

function upgrade(limitNow: number) {
  store.titleLimitRequest = null;
  store.titlesTrimmed = null;
  openUpgrade({ option: "max_active_titles", value: limitNow + 1 });
}

/* ----- After the limit dropped ----- */
const trimmedOpen = computed({
  get: () => !!store.titlesTrimmed,
  set: (value: boolean) => {
    if (!value) store.titlesTrimmed = null;
  },
});
const trimmedText = computed(() => {
  const trimmed = store.titlesTrimmed;
  if (!trimmed) return "";
  const separator = locale.current.value === "fa" ? "، " : ", ";
  return t("$vuetify.titleLimit.trimmed", localDigits(trimmed.limit), trimmed.titles.map(nameOf).join(separator));
});
</script>

<template>
  <v-dialog v-model="open" max-width="440">
    <v-card rounded="xl" class="pa-2">
      <v-card-title class="text-subtitle-1 font-weight-medium">{{ t("$vuetify.titleLimit.title") }}</v-card-title>
      <v-card-text class="d-flex flex-column ga-3">
        <div class="text-body-2">{{ t("$vuetify.titleLimit.body", localDigits(limit)) }}</div>
        <v-list density="compact" class="pa-0 bg-transparent">
          <v-list-item v-for="id in store.activeTitleIds" :key="id" :title="nameOf(id)" class="px-0">
            <template #prepend>
              <TitleAvatar :size="32" :image="titleById(id)?.icon_url" class="me-3" />
            </template>
            <template #append>
              <v-btn size="small" variant="tonal" :loading="busy === id" @click="turnOff(id)">
                {{ t("$vuetify.titleLimit.turnOff") }}
              </v-btn>
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>
      <v-card-actions class="flex-wrap ga-2">
        <v-btn variant="text" @click="open = false">{{ t("$vuetify.titleLimit.close") }}</v-btn>
        <v-spacer />
        <v-btn variant="tonal" color="amber" prepend-icon="mdi-cart-outline" @click="upgrade(limit)">
          {{ t("$vuetify.titleLimit.upgrade") }}
        </v-btn>
        <v-btn v-if="wanted" color="primary" variant="flat" :disabled="!hasRoom" @click="turnOnWanted">
          {{ t("$vuetify.titleLimit.turnOn", nameOf(wanted)) }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-snackbar v-model="trimmedOpen" :timeout="-1" location="bottom" multi-line>
    {{ trimmedText }}
    <template #actions>
      <v-btn variant="text" color="amber" @click="upgrade(store.titlesTrimmed?.limit ?? 0)">
        {{ t("$vuetify.titleLimit.upgrade") }}
      </v-btn>
      <v-btn variant="text" @click="trimmedOpen = false">{{ t("$vuetify.titleLimit.close") }}</v-btn>
    </template>
  </v-snackbar>
</template>
