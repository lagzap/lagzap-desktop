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
        <v-spacer />
        <v-btn
          color="primary"
          rounded
          variant="elevated"
          @click="$emit('register')"
        >
          {{ t('$vuetify.auth.registerDialog.createAccountButton') }}
        </v-btn>
      </template>
    </v-card>
  </v-dialog>
</template>