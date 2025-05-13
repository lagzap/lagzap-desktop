<script lang="ts" setup>
import { useForm } from "vee-validate";
import { object, string } from 'zod';
import { toTypedSchema } from '@vee-validate/zod';
import { ref, onMounted } from 'vue';

const runtimeConfig = useRuntimeConfig()
const requestFetch = useRequestFetch()
const { login } = useSanctumAuth()
const emit = defineEmits(['back'])

interface RegisterProps {
  type: AuthBy;
  entry: string;
}
const props = defineProps<RegisterProps>()

const { defineField, handleSubmit, isSubmitting } = useForm<LoginOtpForm>({
  validationSchema: toTypedSchema(
    object({
      otp: string().min(6).max(6),
    })
  )
});
const [otp, otpAttrs] = defineField("otp", vuetifyConfig);

let otpID: number | undefined

const COOLDOWN_SECONDS = 60
const cooldown = ref(0)
let cooldownInterval: NodeJS.Timeout | undefined

function startCooldown() {
  cooldown.value = COOLDOWN_SECONDS
  if (cooldownInterval) clearInterval(cooldownInterval)
  cooldownInterval = setInterval(() => {
    if (cooldown.value > 0) {
      cooldown.value--
    } else {
      clearInterval(cooldownInterval)
    }
  }, 1000)
}

const onSubmit = handleSubmit(async (values) => {
  try {
    const credentials: LoginOtpCredentials = {
      type: props.type,
      phone: props.type == 'phone' ? parseInt(props.entry) : undefined,
      email: props.type == 'email' ? props.entry : undefined,
      otp: values.otp,
      otpID: otpID,
    }

    await login(credentials)
  } catch (e) {
    displayError(e)
  }
})

async function requestOTP() {
  if (cooldown.value > 0) return // Prevent multiple requests during cooldown
  
  try {
    const data = await requestFetch<OtpResponse>("otp", {
      baseURL: runtimeConfig.public.authBaseUrl,
      method: "POST",
      body: {
        ...props,
        otpID: otpID
      }
    })

    otpID =  data?.otpID

    startCooldown()
    displayAlert(data.message, "info", 1000)
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
    <v-card>
      <v-toolbar color="transparent">
        <template #prepend>
          <v-btn
            :disabled="isSubmitting"
            :icon="$vuetify.locale.isRtl ? 'mdi-arrow-right' : 'mdi-arrow-left'"
            @click="emit('back')"
          />
        </template>

        <v-toolbar-title
          class="text-h6"
          :text="__('auth.login.title')"
        />
      </v-toolbar>
      <v-card-text>
        <div class="d-flex flex-column align-center mb-5">
          <v-avatar
            size="96"
            class="mb-3"
          >
            <LagzapLogo />
          </v-avatar>
          <v-chip
            rounded
            color="primary"
            size="large"
            @click="emit('back')"
          >
            <v-icon
              :icon="type == 'phone' ? 'mdi-phone' : 'mdi-email'"
              start
            />
            {{ entry }}
          </v-chip>
        </div>

        {{ props.type == 'email' ? __('auth.login.descriptionOtpEmail') : __('auth.login.descriptionOtpPhone') }}
        <v-locale-provider :rtl="false">
          <v-otp-input
            v-model="otp"
            v-bind="otpAttrs"
            :error="otpAttrs['error-messages']?.length"
            focus-all
            variant="outlined"
            label="کد یکبار مصرف"
          />
        </v-locale-provider>

        <div class="text-caption">
          {{ __('auth.register.codeNotReceived') }}
          <v-btn
            variant="tonal"
            size="small"
            :disabled="cooldown > 0"
            @click="requestOTP"
          >
            {{ __('auth.register.resendCode') }}
            <span v-if="cooldown > 0">
              ({{ cooldown }})
            </span>
          </v-btn>
        </div>
      </v-card-text>

      <template #actions>
        <v-btn
          rounded
          color="secondary"
          @click="emit('back')"
        >
          {{ __('auth.backButton') }}
        </v-btn>
        <v-spacer />
        <v-btn
          type="submit"
          rounded
          :loading="isSubmitting"
        >
          {{ __('auth.login.loginButton') }}
        </v-btn>
      </template>
    </v-card>
  </v-form>
</template>
