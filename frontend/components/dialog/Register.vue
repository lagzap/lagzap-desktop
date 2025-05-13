<script setup lang="ts">
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
      :title="__('auth.registerDialog.title')"
      :text="__('auth.registerDialog.description')"
    >
      <template #actions>
        <v-spacer />
        <v-btn
          color="primary"
          rounded
          variant="elevated"
          @click="$emit('register')"
        >
          {{ __('auth.registerDialog.createAccountButton') }}
        </v-btn>
      </template>
    </v-card>
  </v-dialog>
</template>