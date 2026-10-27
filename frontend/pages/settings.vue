<script setup lang="ts">
import { useLocale } from "vuetify";
import Container from "~/components/layout/Container.vue";
import General from "~/components/settings/General.vue";
import Routing from "~/components/settings/Routing.vue";
import ClearDNSCache from "~/components/settings/ClearDNSCache.vue";
import Version from "~/components/settings/Version.vue";
import UninstallDriver from "~/components/settings/UninstallDriver.vue";
import Other from "~/components/settings/Other.vue";

const locale = useLocale();
const { t } = locale;

// Rarely needed options stay folded until asked for.
const showMore = ref(false);
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
      <Routing  />
      <v-divider class="mx-4" />
      <Version  />

      <v-expand-transition>
        <div v-if="showMore">
          <v-divider class="mx-4" />
          <ClearDNSCache  />
          <v-divider class="mx-4" />
          <Other  />
          <v-divider class="mx-4" />
          <UninstallDriver  />
        </div>
      </v-expand-transition>

      <div class="px-4 mt-2 mb-5">
        <v-btn
          size="small"
          variant="text"
          :append-icon="showMore ? 'mdi-chevron-up' : 'mdi-chevron-down'"
          @click="showMore = !showMore"
        >
          {{ t(showMore ? '$vuetify.settings.showFewerOptions' : '$vuetify.settings.showMoreOptions') }}
        </v-btn>
      </div>
    </Container>
  </div>
</template>
