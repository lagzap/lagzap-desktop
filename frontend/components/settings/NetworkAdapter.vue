<script lang="ts" setup>
import { GetInterfaces } from '~/bindings/github.com/lagzap/lagzap-desktop/service';
import { useLocale } from "vuetify";

const { t } = useLocale();
const [defaultInterface, interfaces] = await GetInterfaces()
const selected = ref<string | null>(null)
</script>

<template>
  <v-card
    :title="t('$vuetify.settings.networkAdapter')"
    flat
    class="mt-3 bg-transparent"
    max-width="500"
  >
    <v-card-text>
      <v-card-subtitle class="px-0 my-3 text-wrap">
        {{ t('$vuetify.settings.networkAdapterDescription') }}
      </v-card-subtitle>
      <v-select
        v-model="selected"
        :label="t('$vuetify.settings.interfaces')"
        :hint="t('$vuetify.settings.interfacesHint')"
        :items="interfaces.filter(i => (i.Flags & 1) == 1 && (i.Flags & 32) == 32 && ((i.Flags & 4) == 0)).sort((a, b) => a.Name.localeCompare(b.Name))"
        item-value="Name"
        item-title="Name"
        density="comfortable"
        variant="outlined"
        :placeholder="t('$vuetify.settings.leaveInterfaceEmptyAutomatic', [defaultInterface.Name])"
        clearable
      />

      <v-card-subtitle class="px-0 my-3 text-wrap">
        {{ t('$vuetify.settings.multiInternetDescription') }}
      </v-card-subtitle>
      <v-select
        :label="t('$vuetify.settings.multiInternet')"
        :hint="t('$vuetify.settings.multiInternetHint')"
        :items="interfaces.filter(i => (i.Flags & 1) == 1 && (i.Flags & 32) == 32 && ((i.Flags & 4) == 0)).sort((a, b) => a.Name.localeCompare(b.Name))"
        item-value="Name"
        item-title="Name"
        density="comfortable"
        variant="outlined"
        multiple
        chips
        clearable
      />
    </v-card-text>
  </v-card>
</template>
