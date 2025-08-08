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
    :title="t('$vuetify.settings.generalSettings')"
    flat
    class="mt-3 bg-transparent"
    max-width="400"
  >
    <v-card-text class="pb-0 pt-3">
      <v-select
        :model-value="settings.language"
        :items="getLanguages()"
        :return-object="false"
        item-value="value"
        item-title="title"
        :label="t('$vuetify.settings.language')"
        density="comfortable"
        variant="outlined"
        class="mb-4"
        @update:model-value="handleLanguageChange"
      />
      
      <v-select
        :model-value="settings.theme"
        :items="getThemes().map(theme => ({
          ...theme,
          title: theme.value === 'system' ? t('$vuetify.settings.systemTheme') : 
                 theme.value === 'light' ? t('$vuetify.settings.lightTheme') : 
                 t('$vuetify.settings.darkTheme')
        }))"
        :return-object="false"
        item-value="value"
        item-title="title"
        :label="t('$vuetify.settings.theme')"
        density="comfortable"
        variant="outlined"
        @update:model-value="handleThemeChange"
      />
    </v-card-text>
  </v-card>
</template>
