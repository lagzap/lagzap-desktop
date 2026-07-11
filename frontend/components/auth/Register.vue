<script lang="ts" setup>
import { ref } from "vue";
import { useForm } from "vee-validate";
import { object, string } from "zod";
import { toTypedSchema } from "@vee-validate/zod";
import { useLocale } from "vuetify";

const locale = useLocale();
const { t } = locale;
const { login } = useSanctumAuth();

const emit = defineEmits(["back"]);

const otpDialog = ref(false);

interface RegisterProps {
  type: AuthBy;
  entry: string;
}
const props = defineProps<RegisterProps>();

const { defineField, handleSubmit, isSubmitting } = useForm<RegisterForm>({
  validationSchema: toTypedSchema(
    object({
      otp: string().min(6).max(6),
      password: string()
        .min(6, t("$vuetify.validation.required"))
        .max(32, t("$vuetify.validation.max", 32)),
      passwordConfirm: string().min(6, t("$vuetify.validation.required")),
    }).refine((data) => data.password === data.passwordConfirm, {
      message: t("$vuetify.validation.passwordNotMatch"),
      path: ["passwordConfirm"],
    })
  ),
});
const [otp, otpAttrs] = defineField("otp", vuetifyConfig);
const [password, passwordAttrs] = defineField("password", vuetifyConfig);
const [passwordConfirm, passwordConfirmAttrs] = defineField(
  "passwordConfirm",
  vuetifyConfig
);

let otpID: number | undefined;

const onSubmit = handleSubmit(async (values) => {
  try {
    const { data, error } = await useSanctumFetch<RegisterResponse>("/register", {
      method: "POST",
      body: {
        ...props,
        ...values,
        otpID: otpID,
      },
    });
    if (error.value) {
      displayError(error.value, locale);
      return;
    }

    displayAlert(data?.value?.message, "info", 3000);

    await login({
      type: props.type,
      phone: props.type == "phone" ? parseInt(props.entry) : undefined,
      email: props.type == "email" ? props.entry : undefined,
      password: values.password ? values.password : "",
    });
  } catch (e) {
    displayError(e, locale);
  }
});

async function requestOTP() {
  try {
    const { data, error } = await useSanctumFetch<OtpResponse>("/otp", {
      method: "POST",
      body: props,
    });
    if (error.value) {
      displayError(error.value, locale);
      return;
    }

    otpID = data?.value?.otpID;

    displayAlert(data?.value?.message, "info", 3000);
  } catch (e) {
    displayError(e, locale);
  }
}

onMounted(() => {
  requestOTP();
});
</script>

<template>
  <v-form @submit="onSubmit">
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
        :text="t('$vuetify.auth.register.title')"
      />
    </v-toolbar>
    <v-card-text>
      {{
        props.type == "email"
          ? t("$vuetify.auth.register.descriptionEmail")
          : t("$vuetify.auth.register.descriptionPhone")
      }}
      <v-locale-provider :rtl="false">
        <v-otp-input
          v-model="otp"
          v-bind="otpAttrs"
          :error="otpAttrs['error-messages']?.length"
          focus-all
          variant="outlined"
          density="comfortable"
          label="رمز یکبار مصرف"
        />
      </v-locale-provider>

      <div class="text-caption">
        {{ t("$vuetify.auth.register.codeNotReceived") }}
        <v-btn variant="tonal" color="accent" size="small" @click="requestOTP">
          {{ t("$vuetify.auth.register.resendCode") }}
        </v-btn>
      </div>
    </v-card-text>
    <v-card-text>
      <v-text-field
        v-model="password"
        v-bind="passwordAttrs"
        :label="t('$vuetify.auth.fields.password')"
        autofocus
        type="password"
        variant="outlined"
        density="comfortable"
      />
      <v-text-field
        v-model="passwordConfirm"
        v-bind="passwordConfirmAttrs"
        :label="t('$vuetify.auth.fields.passwordConfirm')"
        type="password"
        variant="outlined"
        density="comfortable"
      />
    </v-card-text>

    <v-card-actions>
      <v-btn type="submit" color="primary" variant="tonal" rounded block size="large" :loading="isSubmitting">
        {{ t("$vuetify.auth.register.registerButton") }}
      </v-btn>
    </v-card-actions>
  </v-form>

  <DialogOtp v-model="otpDialog" />
</template>
