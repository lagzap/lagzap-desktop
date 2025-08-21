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
    :title="t('$vuetify.settings.route.routeSettings')"
    flat
    class="mt-3 bg-transparent"
    max-width="500"
  >
    <v-card-text class="pb-0">
      <v-card-subtitle class="px-0 my-3">
        {{ t('$vuetify.settings.route.routeOptimizationAccuracy') }}
      </v-card-subtitle>
      <v-select
        :items="[
          { value: 'veryLow', text: t('$vuetify.settings.route.accuracy.veryLow') },
          { value: 'low', text: t('$vuetify.settings.route.accuracy.low') },
          { value: 'medium', text: t('$vuetify.settings.route.accuracy.medium') },
          { value: 'high', text: t('$vuetify.settings.route.accuracy.high') }
        ]"
        return-object
        item-value="value"
        item-title="text"
        :label="t('$vuetify.settings.route.accuracy.label')"
        density="comfortable"
        variant="outlined"
      />
      <v-card-subtitle class="px-0 my-3">
        {{ t('$vuetify.settings.route.optimizeProtocol') }}
      </v-card-subtitle>
      <v-row dense>
        <v-col>
          <v-select
            :items="[]"
            :return-object="false"
            item-value="value"
            item-title="title"
            :label="t('$vuetify.settings.route.networkProtocol')"
            density="comfortable"
            variant="outlined"
            class="mb-4"
          />
        </v-col>
        <v-col>
          <v-select
            :items="[]"
            :return-object="false"
            item-value="value"
            item-title="title"
            :label="t('$vuetify.settings.route.ipVersion')"
            density="comfortable"
            variant="outlined"
            class="mb-4"
          />
        </v-col>
      </v-row>
      <v-switch
        inset
        :label="t('$vuetify.settings.route.realTimeOptimization')"
      />
    </v-card-text>
  </v-card>
</template>
