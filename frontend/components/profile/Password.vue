<script lang="ts" setup>
import { useForm } from "vee-validate";
import { object, string } from 'zod';
import { toTypedSchema } from '@vee-validate/zod';

const runtimeConfig = useRuntimeConfig()

const otpDialog = ref(false)

const { defineField, handleSubmit, isSubmitting } = useForm<ProfilePasswordForm>({
  validationSchema: toTypedSchema(
    object({
      otp: string().min(6).max(6),
      password: string().min(6, __('validation.required')).max(32, __('validation.max', 32)),
      passwordConfirm: string().min(6, __('validation.required')),
    })
  )
});
const [password, passwordAttrs] = defineField("password", vuetifyConfig);
const [passwordConfirm, passwordConfirmAttrs] = defineField("passwordConfirm", vuetifyConfig);

const onSubmit = handleSubmit(async (values) => {
  try {
    const { data, error } = await useSanctumFetch<ProfileResponse>("profile/password", {
      baseURL: runtimeConfig.public.apiBaseUrl,
      method: "POST",
      body: {
        ...values,
        otpID: otpID,
      }
    })

    if (error.value) {
      return displayError(error)
    }

    if (data.value) {
      displayAlert(data.value.message, "info", 3000)
    }
  } catch (e) {
    displayError(e)
  }
})

let otpID: number | undefined

async function requestOTP() {
  try {
    const { data, error } = await useSanctumFetch<OtpResponse>("otp", {
      baseURL: runtimeConfig.public.apiBaseUrl,
      method: "POST",
      body: {
        type: 'email',
        entry: ''
      }
    })

    if (error.value) {
      return displayError(error)
    }

    otpID =  data.value?.otpID

    if (data.value) {
      displayAlert(data.value.message, "info", 3000)
    }
  } catch (e) {
    displayError(e)
  }
}
</script>

<template>
  <v-form @submit="onSubmit">
    <v-card
      title="Update Password"
      class="mt-3 bg-transparent"
      flat
      max-width="400"
    >
      <v-card-text class="pb-0 pt-3">
        <v-text-field
          v-model="password"
          v-bind="passwordAttrs"
          :label="__('auth.fields.password')"
          variant="outlined"
          density="comfortable"
          class="mb-3"
          type="password"
        />
        <v-text-field
          v-model="passwordConfirm"
          v-bind="passwordConfirmAttrs"
          :label="__('auth.fields.passwordConfirm')"
          variant="outlined"
          density="comfortable"
          type="password"
        />
      </v-card-text>

      <template #actions>
        <v-btn
          type="submit"
          color="tertiary"
          :loading="isSubmitting"
          @click.stop.prevent="requestOTP"
        >
          Update Password
        </v-btn>
      </template>
    </v-card>
  </v-form>

  <DialogOtp v-model="otpDialog" />
</template>
