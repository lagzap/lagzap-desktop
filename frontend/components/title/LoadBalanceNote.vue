<script setup lang="ts">
import { computed } from "vue";
import { useLocale } from "vuetify";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import { useRegionSelection } from "~/composables/useRegionSelection";
import { useProfileInternets } from "~/composables/useProfileInternets";
import { adapterIcon } from "~/utils/adapterIcon";
import { useStore } from "@/stores";
import { ProfileFlag } from "~/constants/profile";

/** On the title's main card, full width: where the profile's traffic goes
 * out — spread over its internets (load balancing on), or all through the
 * one internet picked for it. Nothing while it follows Windows' default. In
 * the default color. */
const props = defineProps<{ profile: Profile }>();
const { t, current } = useLocale();
const store = useStore();
const sel = useRegionSelection(props.profile);
const { isLoadBalanceProfile, isMultiInternetProfile, balanceOn, balanceSelected, dedicatedIpOn, splitAdapter } =
  useProfileInternets(props.profile, sel, false);

const balancing = computed(() => isLoadBalanceProfile.value && balanceOn.value && !dedicatedIpOn.value);
/** Prevent disconnect: a main internet and backups, not one internet. */
const backups = (props.profile.flags & ProfileFlag.PREVENT_DISCONNECT) !== 0;
/** One internet picked (not load balancing, not Multi Internet, no backups)
 * and working: one not connected or without internet is the page's warning
 * instead. */
const single = computed(() => {
  const name =
    !balancing.value && !isMultiInternetProfile.value && !backups && !dedicatedIpOn.value ? splitAdapter.value : "";
  if (!name || !store.availableInterfaceNames.includes(name) || store.internetDownNames.includes(name)) return "";
  return name;
});
const names = computed(() =>
  new Intl.ListFormat(current.value, { type: "conjunction" }).format(balanceSelected.value),
);
</script>

<template>
  <v-alert
    v-if="balancing"
    variant="tonal"
    density="compact"
    rounded="lg"
    icon="mdi-scale-balance"
    class="load-balance-note"
  >
    <div class="text-body-2">
      {{ t("$vuetify.title.profile.loadBalanceOn", [names]) }}
    </div>
    <div class="text-caption text-medium-emphasis">
      {{ t("$vuetify.title.profile.loadBalanceOnHint") }}
    </div>
  </v-alert>
  <v-alert
    v-else-if="single"
    variant="tonal"
    density="compact"
    rounded="lg"
    :icon="adapterIcon(single)"
    class="load-balance-note"
  >
    <div class="text-body-2">
      {{ t("$vuetify.title.profile.singleInternetOn", [single]) }}
    </div>
    <div class="text-caption text-medium-emphasis">
      {{ t("$vuetify.title.profile.singleInternetOnHint") }}
    </div>
  </v-alert>
</template>

<style scoped>
.load-balance-note {
  width: 100%;
}
</style>
