<script setup lang="ts">
import { computed } from "vue";
import { useLocale } from "vuetify";
import { usePlanAccess } from "~/composables/usePlanAccess";

/** "Team plan" wherever the plan shows, when the plan in use is a team's;
 * members also see whose team it is. */
const { t } = useLocale();
const plan = usePlanAccess();

const isTeam = computed(() => plan.access.value?.source === "team");
const label = computed(() => {
  const owner = plan.access.value?.team_owner;
  return plan.access.value?.team_role !== "owner" && owner
    ? t("$vuetify.team.badgeVia", owner)
    : t("$vuetify.team.badge");
});
</script>

<template>
  <v-chip
    v-if="isTeam"
    size="small"
    variant="tonal"
    rounded="pill"
    color="primary"
    prepend-icon="mdi-account-group-outline"
    :to="{ name: 'team' }"
  >
    {{ label }}
  </v-chip>
</template>
