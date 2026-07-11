<script setup lang="ts">
import { useLocale, useTheme } from "vuetify";

const locale = useLocale()
const theme = useTheme()

const {
  settings,
  isLoaded,
  setLanguage,
  getLanguages,
} = useSettings(locale, theme)

const handleLanguageSelect = (language: string) => {
  setLanguage(language)
}

const showLanguageSelection = computed(() => {
  return isLoaded.value && !settings.value.language
})

const { t } = useLocale();

const dialog = defineModel<boolean>({
  required: true,
  default: false
})

</script>

<template>
  <v-menu v-model="dialog">
    <template #activator="{ props }">
      <v-btn v-bind="props" icon="mdi-translate" variant="text" />
    </template>
    <v-list>
      <v-list-item v-for="item in getLanguages()" :key="item.value" :value="item.value"
        @click="handleLanguageSelect(item.value)">
        <v-list-item-title>{{ item.title }}</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>
</template>