<script lang="ts" setup>
import { useForm } from "vee-validate";
import { object, string } from 'zod';
import { toTypedSchema } from '@vee-validate/zod';
import { useLocale } from "vuetify";
import GamerTagDialog from "~/components/account/GamerTagDialog.vue";

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
const editingTag = ref(false)
phone.value = user.value?.phone ?? null
email.value = user.value?.email ?? ''

const onSubmit = handleSubmit(async (values) => {
  try {
    const data = await requestFetch<ProfileResponse>("/profile/basic", {
      method: "POST",
      body: {
        ...values,
      }
    })

    displayServerMessage(data.message, locale)
  } catch (e) {
    displayError(e, locale)
  }
})
</script>

<template>
  <v-form @submit="onSubmit">
    <v-card :title="t('$vuetify.profile.basicInformation')" rounded="xl" class="pa-2">
      <v-card-text class="pb-0 pt-3">
        <v-text-field
          :model-value="data?.user?.name ?? ''"
          :label="t('$vuetify.gamerTag.label')"
          :hint="t('$vuetify.profile.nameHint')"
          persistent-hint
          readonly
          density="comfortable"
          class="mb-4"
          variant="outlined"
          append-inner-icon="mdi-pencil-outline"
          @click:append-inner="editingTag = true"
          @click="editingTag = true"
        />
        <GamerTagDialog v-model="editingTag" @saved="(n: string) => (name = n)" />
        <v-text-field
          v-model="phone"
          v-bind="phoneAttrs"
          :label="t('$vuetify.profile.phone')"
          :hint="t('$vuetify.profile.phoneHint')"
          density="comfortable"
          class="mb-4 lz-sensitive-field"
          variant="outlined"
        />
        <v-text-field
          v-model="email"
          v-bind="emailAttrs"
          :label="t('$vuetify.profile.email')"
          :hint="t('$vuetify.profile.emailHint')"
          density="comfortable"
          class="lz-sensitive-field"
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
