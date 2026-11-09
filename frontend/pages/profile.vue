<script setup lang="ts">
import { ref } from "vue";
import { useLocale } from "vuetify";
import Container from "~/components/layout/Container.vue";
import AccountHeader from "~/components/profile/AccountHeader.vue";
import SubscriptionPanel from "~/components/profile/SubscriptionPanel.vue";
import ConnectionPanel from "~/components/profile/ConnectionPanel.vue";
import ProfileBasic from "~/components/profile/Basic.vue";
import ProfilePassword from "~/components/profile/Password.vue";

const { t } = useLocale();
const { logout } = useSanctumAuth();
const editingProfile = ref(false);
const changingPassword = ref(false);
</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          {{ t('$vuetify.profile.title') }}
        </v-app-bar-title>

        <v-spacer />

        <v-btn variant="tonal" class="me-2" prepend-icon="mdi-account-edit-outline" @click="editingProfile = true">
          {{ t('$vuetify.profile.basicInformation') }}
        </v-btn>
        <v-btn variant="tonal" class="me-2" prepend-icon="mdi-lock-reset" @click="changingPassword = true">
          {{ t('$vuetify.profile.updatePassword') }}
        </v-btn>
        <v-btn variant="tonal" color="red" prepend-icon="mdi-logout" @click="logout">
          {{ t('$vuetify.profile.logout') }}
        </v-btn>
      </template>

      <div class="profile-page">
        <AccountHeader />

        <div class="profile-grid">
          <SubscriptionPanel />
          <ConnectionPanel />
        </div>

        <v-dialog v-model="editingProfile" max-width="500">
          <ProfileBasic />
        </v-dialog>
        <v-dialog v-model="changingPassword" max-width="500">
          <ProfilePassword />
        </v-dialog>

        <section class="lz-panel lz-panel--danger">
          <div class="lz-panel__head">
            <v-icon icon="mdi-alert-octagon-outline" size="20" color="error" />
            <span class="text-subtitle-1 font-weight-medium">{{ t('$vuetify.profile.dangerZone') }}</span>
          </div>
          <div class="d-flex flex-wrap align-center ga-4">
            <div class="flex-grow-1 min-w-0">
              <div class="text-body-1 font-weight-medium">{{ t('$vuetify.profile.deleteAccount') }}</div>
              <div class="text-body-2 text-medium-emphasis">{{ t('$vuetify.profile.deleteAccountConfirmation') }}</div>
            </div>
            <v-tooltip :text="t('$vuetify.profile.deleteSoon')" location="top">
              <template #activator="{ props }">
                <span v-bind="props">
                  <v-btn color="error" variant="tonal" rounded="lg" prepend-icon="mdi-delete-forever-outline" disabled>
                    {{ t('$vuetify.profile.deletePermanent') }}
                  </v-btn>
                </span>
              </template>
            </v-tooltip>
          </div>
        </section>
      </div>
    </Container>
  </div>
</template>

<style scoped>
.profile-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  max-width: 1100px;
}

.profile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}
</style>
