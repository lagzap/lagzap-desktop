<script setup lang="ts">
import { useLocale } from "vuetify";
import Version from "~/components/settings/Version.vue";
import UninstallDriver from "~/components/settings/UninstallDriver.vue";
import Other from "~/components/settings/Other.vue";

// Settings reachable before the app loads (sign-in and start screens): only
// what works without the service. Adapters, routing and the DNS cache live
// on their pages once LagZap is running.
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
        <Other  />
        <v-divider class="mx-4" />
        <UninstallDriver  />
        <v-divider class="mx-4" />
        <Version  />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
