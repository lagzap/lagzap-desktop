<script lang="ts" setup>
import { useLocale, useTheme } from 'vuetify'
import { ClearDNSCache } from '~/bindings/github.com/lagzap/lagzap-desktop/service';

const locale = useLocale()
const { t } = locale
const theme = useTheme()

async function clearCache() {
  await ClearDNSCache();
}
</script>

<template>
  <v-card
    :title="t('$vuetify.settings.DNSCache')"
    flat
    class="mt-3 bg-transparent"
    max-width="500"
  >
    <v-card-text class="pb-0">
      <v-card-subtitle class="px-0 my-3 text-wrap">
        {{ t('$vuetify.settings.clearDNSCacheDescription') }}
      </v-card-subtitle>

      <v-btn
        variant="tonal"
        color="default"
        class="mb-3"
        @click="clearCache"
      >{{ t('$vuetify.settings.clearDNSCacheButton') }}</v-btn>
    </v-card-text>
  </v-card>
</template>
