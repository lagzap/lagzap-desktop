<script setup lang="ts">
import { computed } from "vue";
import { useLocale } from "vuetify";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import { useRegionSelection } from "~/composables/useRegionSelection";
import { useProfileInternets } from "~/composables/useProfileInternets";

/** Under a download profile's speed on the title's card: load balancing is
 * on, over which internets, and what it does. In the default color. */
const props = defineProps<{ profile: Profile }>();
const { t, current } = useLocale();
const sel = useRegionSelection(props.profile);
const { isLoadBalanceProfile, balanceOn, balanceSelected, dedicatedIpOn } = useProfileInternets(
  props.profile,
  sel,
  false,
);
const shown = computed(() => isLoadBalanceProfile.value && balanceOn.value && !dedicatedIpOn.value);
const names = computed(() =>
  new Intl.ListFormat(current.value, { type: "conjunction" }).format(balanceSelected.value),
);
</script>

<template>
  <v-alert
    v-if="shown"
    variant="tonal"
    density="compact"
    rounded="lg"
    icon="mdi-scale-balance"
    class="load-balance-note"
  >
    <div class="text-body-2">{{ t("$vuetify.title.profile.loadBalanceOn", [names]) }}</div>
    <div class="text-caption text-medium-emphasis">{{ t("$vuetify.title.profile.loadBalanceOnHint") }}</div>
  </v-alert>
</template>

<style scoped>
.load-balance-note {
  margin-top: 10px;
  width: 100%;
}
</style>
