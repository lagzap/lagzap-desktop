<script setup lang="ts">
import { useLocale } from "vuetify";

const { t } = useLocale();
defineEmits(['register'])

const dialog = defineModel<boolean>({
  required: true,
  default: false
})

</script>

<template>
  <v-dialog
    v-model="dialog"
    max-width="500"
  >
    <v-card
      :title="t('$vuetify.auth.registerDialog.title')"
      :text="t('$vuetify.auth.registerDialog.description')"
    >
      <template #actions>
        <v-btn
          variant="tonal"
          color="primary"
          block
          rounded
          size="large"
          @click="$emit('register')"
        >
          {{ t('$vuetify.auth.registerDialog.createAccountButton') }}
        </v-btn>
      </template>
    </v-card>
  </v-dialog>
</template>