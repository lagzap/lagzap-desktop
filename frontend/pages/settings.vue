<script setup lang="ts">
import { useLocale } from "vuetify";
import Container from "~/components/layout/Container.vue";
import General from "~/components/settings/General.vue";
import NetworkAdapter from "~/components/settings/NetworkAdapter.vue";
import Routing from "~/components/settings/Routing.vue";
import ClearDNSCache from "~/components/settings/ClearDNSCache.vue";
import Version from "~/components/settings/Version.vue";
import UninstallDriver from "~/components/settings/UninstallDriver.vue";
import Other from "~/components/settings/Other.vue";
import NetworkReport from "~/components/settings/NetworkReport.vue";
import { useStore } from "~/stores";

const locale = useLocale();
const { t } = locale;
const store = useStore();
const isAdmin = computed(() => store.abilities.includes("admin"));
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          {{ t('$vuetify.settings.title') }}
        </v-app-bar-title>
      </template>
      <General  />
      <v-divider class="mx-4" />
      <NetworkAdapter  />
      <v-divider class="mx-4" />
      <Routing  />
      <v-divider class="mx-4" />
      <ClearDNSCache  />
      <v-divider class="mx-4" />
      <Other  />
      <template v-if="isAdmin">
        <v-divider class="mx-4" />
        <NetworkReport />
      </template>
      <v-divider class="mx-4" />
      <UninstallDriver  />
      <v-divider class="mx-4" />
      <Version  />

      <div class="mt-5" />
    </Container>
  </div>
</template>
