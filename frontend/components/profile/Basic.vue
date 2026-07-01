<script lang="ts" setup>
import { useForm } from "vee-validate";
import { object, string } from 'zod';
import { toTypedSchema } from '@vee-validate/zod';
import { useLocale } from "vuetify";

const locale = useLocale();
const { t } = locale
const store = useStore()
const requestFetch = useRequestFetch()
const data = useSanctumUser<DataResponse>();
const user = computed(() => data.value.user)

const clientInfo = computed(() => store.clientInfo)

const { defineField, handleSubmit, isSubmitting } = useForm<ProfileBasicForm>({
  validationSchema: toTypedSchema(
    object({
      name: string().optional(),
      phone: string().optional(),
      email: string().optional(),
    })
  )
});
const [name, nameAttrs] = defineField("name", vuetifyConfig);
const [phone, phoneAttrs] = defineField("phone", vuetifyConfig);
const [email, emailAttrs] = defineField("email", vuetifyConfig);

name.value = user.value?.name ?? ''
phone.value = user.value?.phone ?? null
email.value = user.value?.email ?? ''

const onSubmit = handleSubmit(async (values) => {
  try {
    const data = await requestFetch<ProfileResponse>("http://127.0.0.100:9639/profile/basic", {
      method: "POST",
      body: {
        ...values,
      }
    })

    displayAlert(data.message, "info", 3000)
  } catch (e) {
    displayError(e, locale)
  }
})
</script>

<template>
  <v-form @submit="onSubmit">
    <v-card
      :title="t('$vuetify.profile.basicInformation')"
      class="mt-3 bg-transparent"
      flat
      max-width="500"
    >
      <v-card-text class="pb-0 pt-3">
       a {{ clientInfo }}
        <v-text-field
          v-model="name"
          v-bind="nameAttrs"
          :label="t('$vuetify.profile.name')"
          :hint="t('$vuetify.profile.nameHint')"
          density="comfortable"
          class="mb-4"
          variant="outlined"
        />
        <v-text-field
          v-model="phone"
          v-bind="phoneAttrs"
          :label="t('$vuetify.profile.phone')"
          :hint="t('$vuetify.profile.phoneHint')"
          density="comfortable"
          class="mb-4"
          variant="outlined"
        />
        <v-text-field
          v-model="email"
          v-bind="emailAttrs"
          :label="t('$vuetify.profile.email')"
          :hint="t('$vuetify.profile.emailHint')"
          density="comfortable"
          variant="outlined"
          type="email"
        />
      </v-card-text>

      <template #actions>
        <v-btn
          disabled
          type="submit"
          color="tertiary"
          :loading="isSubmitting"
        >
          Update Profile
        </v-btn>
      </template>
    </v-card>
  </v-form>
</template>
