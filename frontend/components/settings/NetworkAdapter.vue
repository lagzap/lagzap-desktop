<script lang="ts" setup>
import { GetInterfaces } from '~/bindings/github.com/lagzap/lagzap-desktop/service';

const [defaultInterface, interfaces] = await GetInterfaces()
const selected = ref<string>(defaultInterface.Name)
</script>

<template>
  <v-card
    title="Network Adapter"
    flat
    class="mt-3 bg-transparent"
  >
    <v-card-text class="pb-0 pt-3">
      <v-select
        v-model="selected"
        label="Interfaces"
        hint="The interface that LagZap uses to route traffic through"
        max-width="350"
        :items="interfaces.filter(i => (i.Flags & 1) == 1 && (i.Flags & 32) == 32 && ((i.Flags & 4) == 0)).sort((a, b) => a.Name.localeCompare(b.Name))"
        item-value="Name"
        item-title="Name"
        readonly
        density="comfortable"
        variant="outlined"
      />
    </v-card-text>
  </v-card>
</template>
