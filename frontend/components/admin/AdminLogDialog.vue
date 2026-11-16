<script setup lang="ts">
import { useLocale } from "vuetify";
import AdminInsights from "~/components/admin/AdminInsights.vue";

/** Admins: a profile's or title's console log and statistics, live. */
defineProps<{ kind: "profile" | "title"; id: string; name: string }>();
const open = defineModel<boolean>({ default: false });

const { t } = useLocale();
</script>

<template>
  <v-dialog v-model="open" max-width="1000">
    <v-card rounded="xl">
      <v-card-item>
        <v-card-title class="d-flex align-center ga-2">
          <v-icon icon="mdi-console" color="info" />
          {{ t("$vuetify.consoleLog.title", name) }}
        </v-card-title>
        <v-card-subtitle>{{ t("$vuetify.consoleLog.subtitle") }}</v-card-subtitle>
        <template #append>
          <v-btn icon="mdi-close" variant="text" size="small" @click="open = false" />
        </template>
      </v-card-item>
      <v-card-text>
        <AdminInsights v-if="open" :kind="kind" :id="id" />
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
