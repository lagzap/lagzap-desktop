<script setup lang="ts">
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import type { useRegionSelection } from "~/composables/useRegionSelection";
import { useProfileInternets } from "~/composables/useProfileInternets";
import { useStore } from "@/stores";
import { debounce } from "es-toolkit";
import SplitTunnelOptions from "~/components/title/SplitTunnelOptions.vue";
import LoadBalanceOptions from "~/components/title/LoadBalanceOptions.vue";
import ProfileWireGuard from "~/components/title/ProfileWireGuard.vue";
import { useLocale } from "vuetify";

/** A profile's internets and Dedicated IP, as the region selector shows
 * them: Multi Internet (game profiles), load balancing (High traffic), else
 * Split Tunnel; then its Dedicated IP. */
const props = defineProps<{
  profile: Profile;
  sel: ReturnType<typeof useRegionSelection>;
  /** Shown now: the load balance shares refresh only then. */
  live?: boolean;
  /** Its Dedicated IP is shown elsewhere (the picker's sidebar). */
  noDedicatedIp?: boolean;
  /** The title's internets (all its profiles follow them), not the
   * profile's own. */
  forTitle?: boolean;
}>();
const internetStore = useStore();
const titleTarget = props.forTitle
  ? {
      state: () => internetStore.titleStates[props.profile.title_id ?? ""],
      save: debounce(() => void internetStore.saveTitleState(props.profile.title_id ?? ""), 600),
    }
  : undefined;

const { t } = useLocale();
const store = useStore();
const {
  splitAdapter,
  splitAdapters,
  setSplitAdapter,
  toggleSplitTunnel,
  isMultiInternetProfile,
  multiOn,
  multiInherited,
  multiSelected,
  toggleMultiInternet,
  pickInternet,
  isLoadBalanceProfile,
  balanceMode,
  balanceAdapters,
  balanceSelected,
  setBalanceMode,
  pickBalanceInternet,
  pickSingleBalance,
  balancePoolCount,
  followBalanceSettings,
  dedicatedIpOn,
  setLoadBalanceWeight,
  balanceShares,
  adapterIcon,
} = useProfileInternets(props.profile, props.sel, () => !!props.live, titleTarget);
const { orphanedInterfaces, loadingInterfaces, updateInterfaces } = props.sel;
onMounted(() => {
  if (!(props.sel.interfaces.value?.length > 0)) void updateInterfaces();
});
</script>

<template>
  <v-list density="compact" class="py-0" bg-color="transparent" :disabled="!store.appReady">
    <SplitTunnelOptions
      v-if="isMultiInternetProfile"
      multi
      :on="multiOn"
      :inherited="multiInherited"
      :selected="multiSelected"
      :adapters="splitAdapters"
      :missing="orphanedInterfaces"
      :loading="loadingInterfaces"
      :disabled="!store.appReady"
      :live="live"
      :icon="adapterIcon"
      @toggle="toggleMultiInternet"
      @pick="pickInternet"
      @refresh="updateInterfaces"
    />
    <LoadBalanceOptions
      v-else-if="isLoadBalanceProfile"
      :mode="dedicatedIpOn ? 'off' : balanceMode"
      :locked="dedicatedIpOn ? t('$vuetify.title.profile.server.loadBalanceDedicatedIp') : ''"
      :adapters="balanceAdapters"
      :selected="balanceSelected"
      :single-adapters="splitAdapters"
      :single="splitAdapter"
      :system-default="store.defaultInterface || ''"
      :down="store.internetDownNames"
      :missing="orphanedInterfaces"
      :shares="balanceShares"
      :loading="loadingInterfaces"
      :disabled="!store.appReady"
      :live="live"
      :icon="adapterIcon"
      @mode="setBalanceMode"
      @pick="pickBalanceInternet"
      :pool-size="balancePoolCount"
      @single="pickSingleBalance"
      @reset="followBalanceSettings"
      @weight="(name: string, weight: number) => setLoadBalanceWeight(name, weight)"
      @refresh="updateInterfaces"
    />
    <SplitTunnelOptions
      v-else
      :on="!!splitAdapter"
      :selected="splitAdapter ? [splitAdapter] : []"
      :adapters="splitAdapters"
      :missing="orphanedInterfaces"
      :loading="loadingInterfaces"
      :disabled="!store.appReady"
      :live="live"
      :icon="adapterIcon"
      @toggle="toggleSplitTunnel"
      @pick="setSplitAdapter"
      @refresh="updateInterfaces"
    />
    <ProfileWireGuard v-if="!noDedicatedIp" :profile-id="profile.id" :disabled="!store.appReady" />
  </v-list>
</template>
