<script lang="ts" setup>
import { ref } from "vue";
import { useForm } from "vee-validate";
import { object, string } from 'zod';
import { toTypedSchema } from '@vee-validate/zod';

const runtimeConfig = useRuntimeConfig()
const requestFetch = useRequestFetch()
const { login } = useSanctumAuth()

const emit = defineEmits(['back'])

const otpDialog = ref(false)

interface RegisterProps {
  type: AuthBy;
  entry: string;
}
const props = defineProps<RegisterProps>()

const { defineField, handleSubmit, isSubmitting } = useForm<RegisterForm>({
  validationSchema: toTypedSchema(
    object({
      otp: string().min(6).max(6),
      password: string().min(6, __('validation.required')).max(32, __('validation.max', 32)),
      passwordConfirm: string().min(6, __('validation.required')),
    }).refine((data) => data.password === data.passwordConfirm, {
      message:  __('validation.passwordNotMatch'),
      path: ["passwordConfirm"],
    })
  )
});
const [otp, otpAttrs] = defineField("otp", vuetifyConfig);
const [password, passwordAttrs] = defineField("password", vuetifyConfig);
const [passwordConfirm, passwordConfirmAttrs] = defineField("passwordConfirm", vuetifyConfig);

let otpID: number | undefined

const onSubmit = handleSubmit(async (values) => {
  try {
    const data = await requestFetch<RegisterResponse>("register", {
      baseURL: runtimeConfig.public.authBaseUrl,
      method: "POST",
      body: {
        ...props,
        ...values,
        otpID: otpID,
      }
    })

    displayAlert(data.message, "info", 3000)

    const credentials: LoginCredentials = {
      type: props.type,
      phone: props.type == 'phone' ? parseInt(props.entry) : undefined,
      email: props.type == 'email' ? props.entry : undefined,
      password: values.password ? values.password : '',
    }

    await login(credentials)
  } catch (e) {
    displayError(e)
  }
})

async function requestOTP() {
  try {
    const data = await requestFetch<OtpResponse>("otp", {
      baseURL: runtimeConfig.public.authBaseUrl,
      method: "POST",
      body: props
    })

    otpID =  data?.otpID

    displayAlert(data.message, "info", 3000)
  } catch (e) {
    displayError(e)
  }
}

onMounted(() => {
  requestOTP()
})

</script>

<template>
  <v-form @submit="onSubmit">
    <v-card
      :title="__('auth.register.title')"
    >
      <v-card-text>
        {{ props.type == 'email' ? __('auth.register.descriptionEmail') : __('auth.register.descriptionPhone') }}
        <v-locale-provider :rtl="false">
          <v-otp-input
            v-model="otp"
            v-bind="otpAttrs"
            :error="otpAttrs['error-messages']?.length"
            focus-all
            variant="outlined"
            label="رمز یکبار مصرف"
          />
        </v-locale-provider>

        <div class="text-caption">
          {{ __('auth.register.codeNotReceived') }}
          <v-btn
            variant="tonal"
            size="small"
            @click="requestOTP"
          >
            {{ __('auth.register.resendCode') }}
          </v-btn>
        </div>
      </v-card-text>
      <v-card-text>
        <v-text-field
          v-model="password"
          v-bind="passwordAttrs"
          :label="__('auth.fields.password')"
          autofocus
          type="password"
          variant="outlined"
        />
        <v-text-field
          v-model="passwordConfirm"
          v-bind="passwordConfirmAttrs"
          :label="__('auth.fields.passwordConfirm')"
          type="password"
          variant="outlined"
        />
      </v-card-text>

      <template #actions>
        <v-btn
          rounded
          :loading="isSubmitting"
          @click="emit('back')"
        >
          {{ __('auth.backButton') }}
        </v-btn>
        <v-spacer />
        <v-btn
          type="submit"
          color="primary"
          rounded
          :loading="isSubmitting"
        >
          {{ __('auth.register.registerButton') }}
        </v-btn>
      </template>
    </v-card>
  </v-form>

  <DialogOtp v-model="otpDialog" />
</template>
