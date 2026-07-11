<script lang="ts" setup>
import { ref } from "vue";
import { useForm } from "vee-validate";
import { object, string } from "zod";
import { toTypedSchema } from "@vee-validate/zod";
import { useLocale } from "vuetify";

const locale = useLocale();
const { t } = locale;
const emit = defineEmits(["login", "register"]);
const client = useSanctumClient();

const type = ref<AuthBy>();

const { defineField, handleSubmit, isSubmitting } = useForm<EntryForm>({
  validationSchema: toTypedSchema(
    object({
      entry: string().min(1, t("$vuetify.validation.required")),
    })
  ),
});
const [entry, entryAttrs] = defineField("entry", vuetifyConfig);

function isCheckResponse(value: unknown): value is CheckResponse {
  if (!value || typeof value !== "object") {
    return false;
  }

  const result = value as CheckResponse;
  return (
    typeof result.exists === "boolean"
    && (result.type === "email" || result.type === "phone")
  );
}

const onSubmit = handleSubmit(async (values) => {
  try {
    const data = await client<CheckResponse>("/check", {
      method: "POST",
      body: values,
    });

    if (!isCheckResponse(data)) {
      displayAlert(t("$vuetify.auth.checkFailed"), "error");
      return;
    }

    type.value = data.type;
    if (data.exists) {
      emit("login", type.value, entry.value);
    } else {
      emit("register", type.value, entry.value);
    }
  } catch (e) {
    displayError(e, locale);
  }
});
</script>

<template>
  <v-form @submit="onSubmit">
    <div class="d-flex flex-column align-center pt-4">
      <v-avatar size="96">
        <Logo />
      </v-avatar>
      <v-card-title>
        <LogoName />
      </v-card-title>
      <v-card-subtitle>
        {{ t("$vuetify.auth.description") }}
      </v-card-subtitle>
    </div>

    <v-card-text>
      <v-locale-provider :rtl="false">
        <v-text-field
          v-model="entry"
          v-bind="entryAttrs"
          :label="t('$vuetify.auth.fields.entry')"
          variant="outlined"
          density="comfortable"
          :readonly="isSubmitting"
          hide-details
        />
      </v-locale-provider>
    </v-card-text>

    <v-card-actions>
      <v-btn
        type="submit"
        color="primary"
        variant="tonal"
        rounded
        block
        size="large"
        :loading="isSubmitting"
      >
        {{ t("$vuetify.auth.continueButton") }}
      </v-btn>
    </v-card-actions>
  </v-form>
</template>
