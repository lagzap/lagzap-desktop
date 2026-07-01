<script lang="ts" setup>
import { useLocale, useTheme } from 'vuetify'

const locale = useLocale()
const { t } = locale
const theme = useTheme()

const { 
  settings, 
  setLanguage, 
  setTheme, 
  getLanguages, 
  getThemes 
} = useSettings(locale, theme)

const handleLanguageChange = (language: string) => {
  setLanguage(language)
}

const handleThemeChange = (theme: 'system' | 'light' | 'dark') => {
  setTheme(theme)
}
</script>

<template>
  <v-card
    :title="t('$vuetify.settings.other.otherSettings')"
    flat
    class="mt-3 bg-transparent"
    max-width="500"
  >
    <v-card-text class="pb-0">
      <v-switch
        inset
        :label="t('$vuetify.settings.other.disableGPUAcceleration')"
      />
    </v-card-text>
  </v-card>
</template>
