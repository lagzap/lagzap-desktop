<script lang="ts" setup>
import { GetInterfaces } from '~/bindings/github.com/lagzap/lagzap-desktop/service';
import { useLocale } from "vuetify";

const { t } = useLocale();
const [defaultInterface, interfaces] = await GetInterfaces()
const selected = ref<string>(defaultInterface.Name)
</script>

<template>
  <v-card
    :title="t('$vuetify.settings.networkAdapter')"
    flat
    class="mt-3 bg-transparent"
  >
    <v-card-text class="pb-0 pt-3">
      <v-select
        v-model="selected"
        :label="t('$vuetify.settings.interfaces')"
        :hint="t('$vuetify.settings.interfacesHint')"
        max-width="350"
        :items="interfaces.filter(i => (i.Flags & 1) == 1 && (i.Flags & 32) == 32 && ((i.Flags & 4) == 0)).sort((a, b) => a.Name.localeCompare(b.Name))"
        item-value="Name"
        item-title="Name"
        density="comfortable"
        variant="outlined"
      />
    </v-card-text>
  </v-card>
</template>
