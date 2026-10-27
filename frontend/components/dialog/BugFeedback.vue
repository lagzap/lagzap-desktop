<script setup lang="ts">
import { useLocale } from "vuetify";
import { displayAlert, displayError } from "~/composables/alert";

const dialog = defineModel<boolean>({
  required: true,
  default: false,
});

const locale = useLocale();
const { t } = locale;
const route = useRoute();
const store = useStore();
const tickets = useTicketsStore();

const type = ref<"bug" | "feedback">("bug");
const subject = ref("");
const body = ref("");
const attachContext = ref(true);
const submitting = ref(false);
const form = ref();

const typeItems = computed(() => [
  { title: t("$vuetify.tickets.typeBug"), value: "bug" },
  { title: t("$vuetify.tickets.typeFeedback"), value: "feedback" },
]);

const titleContext = computed(() => {
  if (route.name !== "title-id") {
    return null;
  }
  const id = route.params.id as string;
  const title = store.titles.find((item) => item.id === id);
  if (!title) {
    return null;
  }
  return {
    id: title.id,
    name: store.titleName(title.name) || title.id,
  };
});

const attachLabel = computed(() => {
  if (!titleContext.value) {
    return "";
  }
  return t("$vuetify.tickets.attachTitle", [titleContext.value.name]);
});

const rules = {
  required: (v: string) => !!v?.trim() || t("$vuetify.tickets.required"),
  subjectMax: (v: string) =>
    !v || v.length <= 120 || t("$vuetify.tickets.subjectTooLong"),
};

const isDirty = computed(
  () => !!subject.value.trim() || !!body.value.trim() || type.value !== "bug",
);

watch(dialog, (open) => {
  if (!open) {
    return;
  }
  type.value = "bug";
  subject.value = "";
  body.value = "";
  attachContext.value = !!titleContext.value;
});

async function submit() {
  const { valid } = await form.value.validate();
  if (!valid || submitting.value) {
    return;
  }

  submitting.value = true;
  try {
    const requestableType =
      attachContext.value && titleContext.value ? "title" : null;
    const requestableID =
      attachContext.value && titleContext.value ? titleContext.value.id : null;
    await tickets.createTicket(
      type.value,
      subject.value.trim(),
      body.value.trim(),
      requestableType,
      requestableID,
    );
    displayAlert(t("$vuetify.tickets.created"), "success");
    dialog.value = false;
  } catch (error) {
    displayError(error, locale);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="dialog" max-width="560" :persistent="isDirty || submitting">
    <v-card :title="t('$vuetify.tickets.bugFeedbackTitle')">
      <v-card-text>
        <v-form ref="form" @submit.prevent="submit">
          <v-select
            v-model="type"
            :items="typeItems"
            :label="t('$vuetify.tickets.type')"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            class="mb-3"
          />
          <v-text-field
            v-model="subject"
            :label="t('$vuetify.tickets.subject')"
            :rules="[rules.required, rules.subjectMax]"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            class="mb-3"
            maxlength="120"
            counter
          />
          <v-textarea
            v-model="body"
            :label="t('$vuetify.tickets.body')"
            :rules="[rules.required]"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            rows="5"
            auto-grow
            class="mb-3"
          />
          <v-checkbox
            v-if="titleContext"
            v-model="attachContext"
            density="compact"
            hide-details
            :label="attachLabel"
          />
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="dialog = false">
          {{ t("$vuetify.tickets.cancel") }}
        </v-btn>
        <v-btn color="primary" :loading="submitting" @click="submit">
          {{ t("$vuetify.tickets.submit") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
