<script lang="ts" setup>
import { useLocale, useTheme } from 'vuetify'
import { UninstallDriver } from '~/bindings/github.com/lagzap/lagzap-desktop/service';

const locale = useLocale()
const { t } = locale

const uninstallingDriver = ref(false);
const showDisclaimer = ref(false);

async function uninstallDriver() {
  uninstallingDriver.value = true;
  await UninstallDriver();
  uninstallingDriver.value = false;
  showDisclaimer.value = false;
}

function confirmUninstall() {
  showDisclaimer.value = true;
}
</script>

<template>
  <v-card
    :title="t('$vuetify.settings.uninstallDriver')"
    flat
    class="mt-3 bg-transparent"
    max-width="500"
  >
    <v-card-text class="pb-0">
      <v-card-subtitle class="px-0 my-3 text-wrap">
        {{ t('$vuetify.settings.uninstallDriverDescription') }}
      </v-card-subtitle>

      <v-btn
        variant="tonal"
        color="error"
        class="mb-3"
        :loading="uninstallingDriver"
        @click="confirmUninstall"
      >{{ t('$vuetify.settings.uninstallDriverButton') }}</v-btn>
    </v-card-text>

    <v-dialog v-model="showDisclaimer" max-width="500" persistent>
      <v-card>
        <v-card-title class="text-h6 text-error">
          <v-icon icon="mdi-alert-circle" class="me-2" />
          {{ t('$vuetify.settings.uninstallDriverDisclaimer') }}
        </v-card-title>
        
        <v-card-text class="pt-4">
          <p class="text-body-1">
            {{ t('$vuetify.settings.uninstallDriverWarning') }}
          </p>
        </v-card-text>
        
        <v-card-actions class="justify-end">
          <v-btn
            variant="text"
            @click="showDisclaimer = false"
            :disabled="uninstallingDriver"
          >
            {{ t('$vuetify.settings.uninstallDriverCancel') }}
          </v-btn>
          
          <v-btn
            color="error"
            variant="elevated"
            :loading="uninstallingDriver"
            @click="uninstallDriver"
          >
            {{ t('$vuetify.settings.uninstallDriverConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>
