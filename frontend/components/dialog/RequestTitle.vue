<script setup lang="ts">
import { useLocale } from "vuetify";
import { displayAlert, displayError } from "~/composables/alert";
import { useTicketQuickAccess } from "~/composables/useTicketQuickAccess";

const dialog = defineModel<boolean>({
  required: true,
  default: false,
});

const locale = useLocale();
const { t } = locale;
const tickets = useTicketsStore();
const { visitTicket } = useTicketQuickAccess();

const titleName = ref("");
const body = ref("");
const submitting = ref(false);
const form = ref();

const isDirty = computed(
  () => !!titleName.value.trim() || !!body.value.trim(),
);

const rules = {
  required: (v: string) => !!v?.trim() || t("$vuetify.tickets.required"),
  subjectMax: (v: string) =>
    !v || v.length <= 120 || t("$vuetify.tickets.subjectTooLong"),
};

watch(dialog, (open) => {
  if (!open) {
    return;
  }
  titleName.value = "";
  body.value = "";
});

async function submit() {
  const { valid } = await form.value.validate();
  if (!valid || submitting.value) {
    return;
  }

  submitting.value = true;
  try {
    const name = titleName.value.trim();
    const ticket = await tickets.createTicket(
      "request",
      name,
      body.value.trim(),
      null,
      null,
    );
    displayAlert(t("$vuetify.tickets.requestSubmitted"), "success");
    dialog.value = false;
    if (ticket?.id) {
      void visitTicket(ticket.id);
      tickets.openTicketPopup(ticket.id);
    }
  } catch (error) {
    displayError(error, locale);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <v-dialog
    v-model="dialog"
    max-width="560"
    :persistent="isDirty || submitting"
  >
    <v-card :title="t('$vuetify.tickets.requestTitleDialog')">
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{ t("$vuetify.tickets.requestTitleHint") }}
        </p>
        <v-form ref="form" @submit.prevent="submit">
          <v-text-field
            v-model="titleName"
            :label="t('$vuetify.tickets.requestTitleName')"
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
            :label="t('$vuetify.tickets.requestTitleDetails')"
            :rules="[rules.required]"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            rows="4"
            auto-grow
            :hint="t('$vuetify.tickets.requestTitleDetailsHint')"
            persistent-hint
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
