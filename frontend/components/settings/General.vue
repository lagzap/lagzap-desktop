<script lang="ts" setup>
import {useLocale} from "vuetify";

const {current} = useLocale()

</script>

<template>
  <v-card
    title="General Settings"
    flat
    class="mt-3 bg-transparent"
    max-width="400"
  >
    <v-card-text class="pb-0 pt-3">
      <v-select
        v-model="current"
        :items="[
          { title: 'English', value: 'en' },
          { title: 'فارسی', value: 'fa' },
        ]"
        :return-object="false"
        item-value="value"
        item-title="title"
        label="Language"
        density="comfortable"
        variant="outlined"
      />
    </v-card-text>
  </v-card>
</template>
