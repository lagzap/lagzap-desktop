<script lang="ts" setup>
import { useForm } from "vee-validate";
import { object, string, number } from 'zod';
import { toTypedSchema } from '@vee-validate/zod';

const runtimeConfig = useRuntimeConfig()
const requestFetch = useRequestFetch()
const data = useSanctumUser<DataResponse>();
const user = computed(() => data.value.user)

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
    const data = await requestFetch<ProfileResponse>("profile/basic", {
      baseURL: runtimeConfig.public.authBaseUrl,
      method: "POST",
      body: {
        ...values,
      }
    })

    displayAlert(data.message, "info", 3000)
  } catch (e) {
    displayError(e)
  }
})
</script>

<template>
  <v-form @submit="onSubmit">
    <v-card
      title="Basic Information"
      class="mt-3 bg-transparent"
      flat
      max-width="400"
    >
      <v-card-text class="pb-0 pt-3">
        <v-text-field
          v-model="name"
          v-bind="nameAttrs"
          label="Name"
          hint="Your nickname, gamer tag or your full name"
          density="comfortable"
          class="mb-4"
          variant="outlined"
        />
        <v-text-field
          v-model="phone"
          v-bind="phoneAttrs"
          label="Phone"
          hint="You may enter your phone number to enter LagZap"
          density="comfortable"
          class="mb-4"
          variant="outlined"
        />
        <v-text-field
          v-model="email"
          v-bind="emailAttrs"
          label="Email"
          hint="Will be used to email updates or entering LagZap"
          density="comfortable"
          variant="outlined"
          type="email"
        />
      </v-card-text>

      <template #actions>
        <v-btn
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
