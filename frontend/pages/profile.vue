<script setup lang="ts">
import Container from "~/components/layout/Container.vue";

const { logout } = useSanctumAuth();
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title>Profile</v-app-bar-title>

        <v-spacer />

        <v-btn variant="tonal" color="red" @click="logout">
          Logout
        </v-btn>
      </template>
      <ProfileBasic />

      <v-divider class="mx-4" />

      <ProfilePassword />

      <v-divider class="mx-4" />

      <v-card
        title="Delete Account"
        class="mt-3 bg-transparent"
        flat
        max-width="600"
      >
        <v-card-text>
          Once your account is deleted, all of its resources and data will be
          permanently deleted. But in some cases your data may remain in for 
          at least 6 months.
        </v-card-text>

        <template #actions>
          <v-btn color="error" disabled> Delete Permanently </v-btn>
        </template>
      </v-card>
    </Container>
  </div>
</template>
