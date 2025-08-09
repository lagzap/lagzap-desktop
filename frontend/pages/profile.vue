<script setup lang="ts">
import { useLocale } from "vuetify";
import Container from "~/components/layout/Container.vue";

const locale = useLocale();
const { t } = locale
const { logout } = useSanctumAuth();
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          {{ t('$vuetify.profile.title') }}
        </v-app-bar-title>

        <v-spacer />

        <v-btn variant="tonal" color="red" @click="logout">
          {{ t('$vuetify.profile.logout') }}
        </v-btn>
      </template>
      <ProfileBasic />

      <v-divider class="mx-4" />

      <ProfilePassword />

      <v-divider class="mx-4" />

      <v-card
        :title="t('$vuetify.profile.deleteAccount')"
        class="mt-3 bg-transparent"
        flat
        max-width="600"
      >
        <v-card-text>
          {{ t('$vuetify.profile.deleteAccountConfirmation') }}
        </v-card-text>

        <template #actions>
          <v-btn color="error" disabled> {{ t('$vuetify.profile.deletePermanent') }} </v-btn>
        </template>
      </v-card>
    </Container>
  </div>
</template>
