<script lang="ts" setup>
import { useForm } from "vee-validate";
import { object, string } from 'zod';
import { toTypedSchema } from '@vee-validate/zod';

const { login } = useSanctumAuth()

const emit = defineEmits(['back', 'otp'])

interface RegisterProps {
  type: AuthBy;
  entry: string;
}
const props = defineProps<RegisterProps>()

const { defineField, handleSubmit, isSubmitting } = useForm<LoginForm>({
  validationSchema: toTypedSchema(
    object({
      password: string().min(6, __('validation.required')).max(32, __('validation.max', 32)),
    })
  )
});
const [password, passwordAttrs] = defineField("password", vuetifyConfig);

const onSubmit = handleSubmit(async (values) => {
  try {
    const credentials: LoginCredentials = {
      type: props.type,
      phone: props.type == 'phone' ? parseInt(props.entry) : undefined,
      email: props.type == 'email' ? props.entry : undefined,
      password: values.password,
    }

    await login(credentials)
  } catch (e) {
    displayError(e)
  }
})

async function requestOTP() {
  emit('otp', props.type, props.entry, true)
}

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

        <v-text-field
          v-model="password"
          v-bind="passwordAttrs"
          autofocus
          type="password"
          variant="outlined"
          :label="__('auth.fields.password')"
        />
      </v-card-text>

      <template #actions>
        <v-btn
          rounded
          color="secondary"
          @click="requestOTP"
        >
          {{ __('auth.login.otpLogin') }}
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
