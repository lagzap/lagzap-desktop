<script setup lang="ts">
import { useLocale, useTheme } from 'vuetify'
import Settings from '~/components/dialog/Settings.vue';
import Language from '~/components/dialog/Language.vue';
import Theme from '~/components/dialog/Theme.vue';

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

const languageDialog = ref(false)
const themeDialog = ref(false)
const settingsDialog = ref(false)
</script>

<template>
  <v-app>
    <v-app-bar v-if="!showLanguageSelection" density="comfortable" color="transparent" flat tile>
      <Language v-model="languageDialog" />
      <Theme v-model="themeDialog" />
      <Settings v-model="settingsDialog" />

      <v-spacer />
    </v-app-bar>

    <v-main>
      <v-container class="h-100">
        <div class="d-flex align-center justify-center h-100">
          <v-scale-transition leave-absolute>
            <v-card v-if="showLanguageSelection" width="500px">
              <v-card-title class="text-h5 text-center pa-6">
                <v-icon class="me-2" size="large">
                  mdi-translate
                </v-icon>
                <div>
                  <div>Choose Language</div>
                  <div class="text-body-2 mt-1">
                    انتخاب زبان
                  </div>
                </div>
              </v-card-title>

              <v-card-text class="pa-6">
                <v-row>
                  <v-col v-for="language in getLanguages()" :key="language.value" cols="6">
                    <v-card variant="plain" :title="language.title" class="pa-4 text-center"
                      @click="handleLanguageSelect(language.value)" />
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>

            <v-card v-else max-height="80vh" width="450px">
              <slot />
            </v-card>
          </v-scale-transition>
        </div>
      </v-container>
    </v-main>
  </v-app>
</template>
