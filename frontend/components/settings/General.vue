<script lang="ts" setup>
import { useLocale, useTheme } from 'vuetify'

const locale = useLocale()
const { t } = locale
const theme = useTheme()

const {
  settings,
  setLanguage,
  setTheme,
  setAllowSendDebugInfo,
  setAllowSendAnonymousData,
  setLaunchOnStartup,
  setLaunchOnStartupMinimize,
  setActiveOnStart,
  getLanguages,
  getThemes,
} = useSettings(locale, theme)
</script>

<template>
  <v-card
    :title="t('$vuetify.settings.generalSettings')"
    flat
    class="mt-3 bg-transparent"
    max-width="500"
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
        @update:model-value="(value) => void setLanguage(value)"
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
        class="mb-6"
        @update:model-value="(value) => void setTheme(value)"
      />

      <v-card-subtitle class="px-0 mb-1">
        {{ t('$vuetify.settings.privacy.title') }}
      </v-card-subtitle>
      <v-checkbox
        hide-details
        class="mb-1"
        :label="t('$vuetify.settings.privacy.allowSendDebugInfo')"
        :model-value="settings.allowSendDebugInfo"
        @update:model-value="setAllowSendDebugInfo"
      />
      <v-checkbox
        hide-details
        class="mb-5"
        :label="t('$vuetify.settings.privacy.allowSendAnonymousData')"
        :model-value="settings.allowSendAnonymousData"
        @update:model-value="setAllowSendAnonymousData"
      />

      <v-card-subtitle class="px-0 mb-1">
        {{ t('$vuetify.settings.startup.title') }}
      </v-card-subtitle>
      <v-checkbox
        hide-details
        class="mb-1"
        :label="t('$vuetify.settings.startup.launchOnStartup')"
        :model-value="settings.launchOnStartup"
        @update:model-value="setLaunchOnStartup"
      />
      <v-checkbox
        hide-details
        class="mb-1"
        :disabled="!settings.launchOnStartup"
        :label="t('$vuetify.settings.startup.launchOnStartupMinimize')"
        :model-value="settings.launchOnStartupMinimize"
        @update:model-value="setLaunchOnStartupMinimize"
      />
      <v-checkbox
        hide-details
        :label="t('$vuetify.settings.startup.activeOnStart')"
        :model-value="settings.activeOnStart"
        @update:model-value="setActiveOnStart"
      />
    </v-card-text>
  </v-card>
</template>
