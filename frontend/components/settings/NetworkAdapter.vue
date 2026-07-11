<script lang="ts" setup>
import { useLocale } from "vuetify";

const { t } = useLocale();
const { defaultInterface, interfaces, updateInterfaces } = useStore()
const selected = ref<string | null>(null)

const loading = ref(false)

async function update() {
  loading.value = true
  await updateInterfaces()
  loading.value = false
}
</script>

<template>
  <v-card
    :title="t('$vuetify.settings.networkAdapter')"
    flat
    class="mt-3 bg-transparent"
    max-width="500"
  >
    <v-card-text>
      <v-card-subtitle class="px-0 my-3 text-wrap">
        {{ t('$vuetify.settings.networkAdapterDescription') }}
      </v-card-subtitle>
      <v-select
        v-model="selected"
        :loading="loading"
        :label="t('$vuetify.settings.interfaces')"
        :hint="t('$vuetify.settings.interfacesHint')"
        :items="interfaces"
        item-value="Name"
        item-title="Name"
        density="comfortable"
        variant="outlined"
        :placeholder="t('$vuetify.settings.leaveInterfaceEmptyAutomatic', [defaultInterface])"
        clearable
        @click="update"
      />

      <template>
        <v-card-subtitle class="px-0 my-3 text-wrap">
          {{ t('$vuetify.settings.multiInternetDescription') }}
        </v-card-subtitle>
        <v-select
          :loading="loading"
          :label="t('$vuetify.settings.multiInternet')"
          :hint="t('$vuetify.settings.multiInternetHint')"
          :items="interfaces"
          item-value="Name"
          item-title="Name"
          density="comfortable"
          variant="outlined"
          multiple
          chips
          clearable
          @click="update"
        />
      </template>
    </v-card-text>
  </v-card>
</template>
