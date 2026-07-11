<script setup lang="ts">
import { useLocale, useTheme } from 'vuetify'

const locale = useLocale()
const theme = useTheme()

const {
  settings,
  isLoaded,
  setTheme,
  getThemes
} = useSettings(locale, theme)

const handleThemeSelect = (themeValue: 'system' | 'light' | 'dark') => {
  setTheme(themeValue)
}

const showLanguageSelection = computed(() => {
  return isLoaded.value && !settings.value.language
})

const dialog = defineModel<boolean>({
  required: true,
  default: false
})

</script>

<template>
  <v-menu v-model="dialog">
    <template #activator="{ props }">
      <v-btn v-bind="props" icon="mdi-theme-light-dark" variant="text" />
    </template>
    <v-list>
      <v-list-item v-for="item in getThemes()" :key="item.value" :value="item.value"
        @click="handleThemeSelect(item.value as ('system' | 'light' | 'dark'))">
        <v-list-item-title>{{ item.title }}</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>
</template>