<script lang="ts" setup>
import { ref } from "vue";
import { useForm } from "vee-validate";
import { object, string } from 'zod';
import { toTypedSchema } from '@vee-validate/zod';
import { useLocale } from "vuetify";

const locale = useLocale();
const { t } = locale;
const runtimeConfig = useRuntimeConfig()
const requestFetch = useRequestFetch()
const emit = defineEmits(['login', 'register'])

const type = ref<AuthBy>()

const { defineField, handleSubmit, isSubmitting } = useForm<EntryForm>({
  validationSchema: toTypedSchema(
    object({
      entry: string().min(1, t('$vuetify.validation.required'))
    })
  )
});
const [entry, entryAttrs] = defineField("entry", vuetifyConfig);

const onSubmit = handleSubmit(async (values) => {
  try {
    const data = await requestFetch<CheckResponse>("/check", {
      baseURL: runtimeConfig.public.authBaseUrl,
      method: "POST",
      body: values
    })

    type.value = data?.type
    if (data?.exists) {
      emit('login', type.value, entry.value)
    } else {
      emit('register', type.value, entry.value)
    }
  } catch (e) {
    displayError(e, locale)
  }
})

</script>

<template>
  <v-form @submit="onSubmit">
    <v-card>
      <div class="d-flex flex-column align-center pt-4">
        <v-avatar size="96">
          <LagzapLogo />
        </v-avatar>
        <v-card-title>
          <span class="lagzap-name">
            {{ t('$vuetify.app_name') }}
          </span>
        </v-card-title>
        <v-card-subtitle>
          {{ t('$vuetify.auth.description') }}
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
          />
        </v-locale-provider>
      </v-card-text>

      <template #actions>
        <v-spacer />
        <v-btn
          type="submit"
          color="secondary"
          variant="tonal"
          rounded
          :loading="isSubmitting"
        >
          {{ t('$vuetify.auth.continueButton') }}
        </v-btn>
      </template>
    </v-card>
  </v-form>
</template>
