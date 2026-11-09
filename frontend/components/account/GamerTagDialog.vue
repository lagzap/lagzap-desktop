<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useLocale } from "vuetify";
import { SetGamerTag } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { GAMER_TAG_MAX, gamerTagRules, isValidGamerTag } from "~/composables/gamerTag";
import { useTeam } from "~/composables/useTeam";

/** Choose or change the gamer tag. `required`: the account has none, so
 * the dialog cannot be closed (no close button, Esc or backdrop) until a
 * valid one is saved. */
const props = withDefaults(defineProps<{ modelValue: boolean; required?: boolean }>(), { required: false });
const emit = defineEmits<{ "update:modelValue": [open: boolean]; saved: [name: string] }>();

const { t } = useLocale();
const { refreshIdentity, user } = useSanctumAuth<DataResponse>();
const { errorText } = useTeam();

const name = ref("");
const saving = ref(false);
const serverError = ref("");

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      name.value = user.value?.user?.name ?? "";
      serverError.value = "";
    }
  },
  { immediate: true },
);
watch(name, () => (serverError.value = ""));

const rules = computed(() => gamerTagRules(name.value));
const valid = computed(() => isValidGamerTag(name.value));

async function save() {
  if (!valid.value || saving.value) return;
  saving.value = true;
  try {
    const result = await SetGamerTag(name.value);
    if (result.error) {
      serverError.value = errorText(result.error);
      return;
    }
    await refreshIdentity().catch(() => undefined);
    emit("saved", result.name);
    emit("update:modelValue", false);
  } catch {
    serverError.value = errorText({ code: "unreachable", message: "unreachable", unlocks_at: "" });
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-dialog
    :model-value="props.modelValue"
    :persistent="props.required"
    :no-click-animation="props.required"
    max-width="440"
    @update:model-value="(open: boolean) => !props.required && emit('update:modelValue', open)"
  >
    <v-card rounded="xl" class="pa-2">
      <v-card-title class="d-flex align-center ga-2">
        <v-avatar color="primary" variant="tonal" icon="mdi-account-star-outline" size="36" />
        <span>{{ t("$vuetify.gamerTag.title") }}</span>
        <v-spacer />
        <v-btn
          v-if="!props.required"
          icon="mdi-close"
          variant="text"
          size="small"
          @click="emit('update:modelValue', false)"
        />
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ props.required ? t("$vuetify.gamerTag.requiredHint") : t("$vuetify.gamerTag.changeHint") }}
        </p>
        <v-text-field
          v-model="name"
          :label="t('$vuetify.gamerTag.label')"
          :counter="GAMER_TAG_MAX"
          :error-messages="serverError"
          variant="outlined"
          density="comfortable"
          autofocus
          @keydown.enter="save"
        />
        <div class="gamer-tag__rules">
          <div v-for="rule in rules" :key="rule.key" class="gamer-tag__rule" :class="{ 'gamer-tag__rule--ok': rule.ok }">
            <v-icon :icon="rule.ok ? 'mdi-check-circle' : 'mdi-circle-outline'" size="14" />
            <span>{{ t(`$vuetify.gamerTag.rules.${rule.key}`) }}</span>
          </div>
        </div>
      </v-card-text>
      <v-card-actions class="px-4 pb-3">
        <v-spacer />
        <v-btn variant="tonal" color="primary" rounded="lg" :disabled="!valid" :loading="saving" @click="save">
          {{ t("$vuetify.gamerTag.save") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.gamer-tag__rules {
  display: grid;
  gap: 4px;
}

.gamer-tag__rule {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.gamer-tag__rule--ok {
  color: rgb(var(--v-theme-success));
}
</style>
