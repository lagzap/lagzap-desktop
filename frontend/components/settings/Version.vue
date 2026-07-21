<script lang="ts" setup>
import { useLocale } from 'vuetify'
import { CheckForUpdates, GetVersion } from '~/bindings/github.com/lagzap/lagzap-desktop/service';

const locale = useLocale()
const { t } = locale

const version = ref('…')
const checking = ref(false)

onMounted(async () => {
  try {
    version.value = (await GetVersion()) || 'unknown'
  } catch {
    version.value = 'unknown'
  }
})

async function checkForUpdate() {
  if (checking.value) return
  checking.value = true
  try {
    await CheckForUpdates()
  } finally {
    checking.value = false
  }
}
</script>

<template>
  <v-card
    :title="t('$vuetify.settings.version')"
    flat
    class="mt-3 bg-transparent"
    max-width="500"
  >
    <v-card-text class="pb-0">
      <v-card-subtitle class="px-0 my-3 text-wrap">
        {{ t('$vuetify.settings.versionDescription', version) }}
      </v-card-subtitle>

      <v-btn
        variant="tonal"
        color="default"
        class="mb-3"
        :loading="checking"
        @click="checkForUpdate"
      >{{ t('$vuetify.settings.checkForUpdate') }}</v-btn>
    </v-card-text>
  </v-card>
</template>
