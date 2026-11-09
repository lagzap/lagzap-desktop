<script setup lang="ts">
import { computed } from "vue";
import { useLocale } from "vuetify";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { useTeam } from "~/composables/useTeam";

/** What accepting an invitation means for this user: their own plan keeps
 * running, or they must leave their current team first. */
const { t } = useLocale();
const plan = usePlanAccess();
const { team, active } = useTeam();

const inTeam = computed(() => !!team.value && active.value);
const ownPlan = computed(() => plan.active.value && plan.access.value?.source !== "team" && !plan.admin.value);
</script>

<template>
  <div v-if="inTeam || ownPlan" class="text-caption text-medium-emphasis d-flex align-start ga-1">
    <v-icon :icon="inTeam ? 'mdi-alert-circle-outline' : 'mdi-information-outline'" size="14" class="mt-px" />
    <span>{{ inTeam ? t("$vuetify.team.invite.leaveFirst") : t("$vuetify.team.invite.ownPlanKeeps") }}</span>
  </div>
</template>
