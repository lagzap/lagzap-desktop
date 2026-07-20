<script lang="ts" setup>
import { useLocale, useTheme } from 'vuetify'

const locale = useLocale()
const { t } = locale
const theme = useTheme()

const { settings, setGpuAcceleration } = useSettings(locale, theme)
</script>

<template>
  <v-card
    :title="t('$vuetify.settings.other.otherSettings')"
    flat
    class="mt-3 bg-transparent"
    max-width="500"
  >
    <v-card-text class="pb-0">
      <v-checkbox
        :label="t('$vuetify.settings.other.disableGPUAcceleration')"
        :model-value="!settings.gpuAcceleration"
        @update:model-value="setGpuAcceleration(!$event)"
      />
    </v-card-text>
  </v-card>
</template>
