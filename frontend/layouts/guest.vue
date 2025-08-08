<script setup lang="ts">
import { useLocale, useTheme } from 'vuetify'

const locale = useLocale()
const theme = useTheme()

const { 
  settings, 
  isLoaded, 
  setLanguage, 
  setTheme,
  getLanguages,
  getThemes 
} = useSettings(locale, theme)

const handleLanguageSelect = (language: string) => {
  setLanguage(language)
}

const handleThemeSelect = (themeValue: 'system' | 'light' | 'dark') => {
  setTheme(themeValue)
}

const showLanguageSelection = computed(() => {
  return isLoaded.value && !settings.value.language
})
</script>

<template>
  <v-app>
    <v-app-bar
      v-if="!showLanguageSelection"
      density="comfortable"
      color="transparent"
      flat
      tile
    >
      <v-menu>
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            icon="mdi-translate"
            variant="text"
          />
        </template>
        <v-list>
          <v-list-item
            v-for="item in getLanguages()"
            :key="item.value"
            :value="item.value"
            @click="handleLanguageSelect(item.value)"
          >
            <v-list-item-title>{{ item.title }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
      
      <v-menu>
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            icon="mdi-theme-light-dark"
            variant="text"
          />
        </template>
        <v-list>
          <v-list-item
            v-for="item in getThemes()"
            :key="item.value"
            :value="item.value"
            @click="handleThemeSelect(item.value as ('system' | 'light' | 'dark'))"
          >
            <v-list-item-title>{{ item.title }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
      
      <v-spacer />
    </v-app-bar>

    <v-main>
      <v-container class="h-100">
        <div class="d-flex align-center justify-center h-100">
          <v-scale-transition leave-absolute>
            <v-card
              v-if="showLanguageSelection"
              width="500px"
            >
              <v-card-title class="text-h5 text-center pa-6">
                <v-icon
                  class="me-2"
                  size="large"
                >
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
                  <v-col
                    v-for="language in getLanguages()"
                    :key="language.value"
                    cols="6"
                  >
                    <v-card
                      variant="plain"
                      :title="language.title"
                      class="pa-4 text-center"
                      @click="handleLanguageSelect(language.value)"
                    />
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>

            <v-card
              v-else
              max-height="80vh"
              width="450px"
            >
              <slot />
            </v-card>
          </v-scale-transition>
        </div>
      </v-container>
    </v-main>
  </v-app>
</template>
