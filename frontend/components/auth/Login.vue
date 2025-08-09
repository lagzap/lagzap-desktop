<script lang="ts" setup>
import { useForm } from "vee-validate";
import { useLocale } from "vuetify";
import { object, string } from 'zod';
import { toTypedSchema } from '@vee-validate/zod';

const  locale = useLocale()
const { t } = locale
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
      password: string().min(6, t('$vuetify.validation.required')).max(32, t('$vuetify.validation.max', 32)),
    })
  )
});
const [password, passwordAttrs] = defineField("password", vuetifyConfig);

const onSubmit = handleSubmit(async (values) => {
  try {
    await login({
      type: props.type,
      phone: props.type == 'phone' ? parseInt(props.entry) : undefined,
      email: props.type == 'email' ? props.entry : undefined,
      password: values.password,
    })
  } catch (e) {
    displayError(e, locale)
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
          :text="t('$vuetify.auth.login.title')"
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
            color="secondary"
            variant="tonal"
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
          density="comfortable"
          :label="t('$vuetify.auth.fields.password')"
        />
      </v-card-text>

      <template #actions>
        <v-btn
          rounded
          color="secondary"
          variant="text"
          @click="requestOTP"
        >
          {{ t('$vuetify.auth.login.otpLogin') }}
        </v-btn>
        <v-spacer />
        <v-btn
          type="submit"
          color="secondary"
          variant="tonal"
          rounded
          :loading="isSubmitting"
        >
          {{ t('$vuetify.auth.login.loginButton') }}
        </v-btn>
      </template>
    </v-card>
  </v-form>
</template>
