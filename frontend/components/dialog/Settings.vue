<script setup lang="ts">
import { useLocale } from "vuetify";
import General from "~/components/settings/General.vue";
import NetworkAdapter from "~/components/settings/NetworkAdapter.vue";
import Routing from "~/components/settings/Routing.vue";
import ClearDNSCache from "~/components/settings/ClearDNSCache.vue";
import Version from "~/components/settings/Version.vue";
import UninstallDriver from "~/components/settings/UninstallDriver.vue";
import Other from "~/components/settings/Other.vue";

const { t } = useLocale();

const dialog = defineModel<boolean>({
  required: true,
  default: false
})

</script>

<template>
  <v-dialog
    v-model="dialog"
    max-width="800"
  >
    <template #activator="{ props }">
      <v-btn v-bind="props" icon="mdi-cog" variant=text />
    </template>
    <v-card
      :title="t('$vuetify.settings.title')"
    >
      <v-card-text>
        <NetworkAdapter  />
        <v-divider class="mx-4" />
        <ClearDNSCache  />
        <v-divider class="mx-4" />
        <Other  />
        <v-divider class="mx-4" />
        <UninstallDriver  />
        <v-divider class="mx-4" />
        <Version  />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>