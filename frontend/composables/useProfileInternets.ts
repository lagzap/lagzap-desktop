import { computed, onBeforeUnmount, ref, toValue, watch, type MaybeRefOrGetter } from "vue";
import type { Profile, ProfileState, TitleState } from "~/bindings/github.com/lagzap/zap/data";
import { ProfileFlag } from "~/constants/profile";
import { adapterIcon } from "~/utils/adapterIcon";
import { useStore } from "@/stores";
import { useNetworkAdapterSettings } from "~/composables/useNetworkAdapterSettings";
import { useProfileWireGuard } from "~/composables/useProfileWireGuard";
import { useSettings } from "~/composables/useSettings";
import type { useRegionSelection } from "~/composables/useRegionSelection";
import type { LoadBalanceMode } from "~/components/title/LoadBalanceOptions.vue";
import { GetLoadBalanceShares } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { LoadBalanceShare } from "~/bindings/github.com/lagzap/lagzap/adapter";

/** A profile's internets: Split Tunnel (one adapter), Multi Internet (game
 * profiles), load balancing (High traffic ones) and the Dedicated IP that
 * rules them out. The full region selector and the title's picker page
 * both show them (ProfileInternetOptions). `live` while shown: the load
 * balance shares refresh only then. With `title`, they are the title's
 * (all its profiles follow them), saved on each change. */
export function useProfileInternets(
  profile: Profile,
  sel: ReturnType<typeof useRegionSelection>,
  live: MaybeRefOrGetter<boolean>,
  title?: { state: () => TitleState | undefined; save: () => void },
) {
  const store = useStore();
  /** What is edited: the title's, or the profile's (saved by its autosave). */
  const target = (): Partial<ProfileState> | undefined =>
    title ? (title.state() as Partial<ProfileState> | undefined) : store.profileStates[profile.id];
  const changed = () => title?.save();
  const { multiInternet } = useNetworkAdapterSettings();
  // Split Tunnel: send this profile out through one adapter, with any server
  // choice (a country, a city, Automatic). The core binds the profile's relay
  // and direct traffic to default_interface (the profile's Network adapter
  // setting); empty = the system's adapter.
  const splitAdapter = computed(() =>
    title ? (title.state()?.default_interface ?? "") : sel.selectedDefaultInterface.value,
  );
  /** Adapters to offer, plus saved ones that are gone now (shown in warning). */
  const splitAdapters = computed(() => {
    const names = (sel.interfaces.value ?? []).map((iface) => iface.Name);
    const saved = [splitAdapter.value, ...(target()?.network_interfaces ?? [])];
    // "*" and "-" are settings (follow Multi Internet / load balancing off),
    // not adapters.
    for (const name of saved) if (name && name !== "*" && name !== LOAD_BALANCE_OFF && !names.includes(name)) names.push(name);
    return names;
  });
  function setSplitAdapter(name: string) {
    const st = target();
    if (!st) return;
    st.default_interface = name;
    changed();
  }
  /** Turning it on picks the adapter the system uses now, so nothing changes
   * until another one is chosen; off goes back to the system's choice. */
  function toggleSplitTunnel() {
    if (splitAdapter.value) {
      setSplitAdapter("");
      return;
    }
    const names = splitAdapters.value;
    const current = store.defaultInterface && names.includes(store.defaultInterface) ? store.defaultInterface : names[0];
    if (current) setSplitAdapter(current);
  }

  // Multi Internet profiles: the same switch edits the profile's Multi Internet
  // adapters (network_interfaces) instead. Empty follows the Multi Internet
  // settings; one adapter is Multi Internet off for this profile.
  const isMultiInternetProfile = computed(() => (profile.flags & ProfileFlag.MULTIPATH) !== 0);
  const ownInternets = computed(() =>
    (target()?.network_interfaces ?? []).filter(Boolean),
  );
  const settingsInternets = computed(() => multiInternet.selection.value);
  const multiOn = computed(() => ownInternets.value.length > 1);
  /** Not set on the profile, and the settings already join several internets. */
  const multiInherited = computed(() => ownInternets.value.length === 0 && settingsInternets.value.length > 1);
  // "-" is Multi Internet off on the Default internet: no internet ticked.
  const multiSelected = computed(() =>
    ownInternets.value.length > 0
      ? ownInternets.value.filter((n) => n !== "-" && n !== "*")
      : settingsInternets.value,
  );
  function setOwnInternets(names: string[]) {
    const st = target();
    if (!st) return;
    // The title's internets start with the adapter it uses now.
    if (title && st.default_interface == null) st.default_interface = "";
    st.network_interfaces = names;
    changed();
  }
  function toggleMultiInternet() {
    if (multiOn.value) {
      // Off: one internet. Clearing would fall back to the settings, which may
      // have Multi Internet on.
      const keep = multiSelected.value[0];
      setOwnInternets(settingsInternets.value.length > 1 && keep ? [keep] : []);
      return;
    }
    const pool = settingsInternets.value.length > 1 ? settingsInternets.value : splitAdapters.value;
    setOwnInternets([...pool]);
  }
  function pickInternet(name: string) {
    // Off (radios): the one internet the profile uses.
    if (!multiOn.value && !multiInherited.value) {
      setOwnInternets([name]);
      return;
    }
    // On (checkboxes): two or more ticked is Multi Internet; unticking down to
    // one turns it off on that internet.
    const current = multiSelected.value;
    const next = current.includes(name) ? current.filter((n) => n !== name) : [...current, name];
    if (next.length >= 1) setOwnInternets(next);
  }

  // Load balancing (High traffic profiles: downloads, CDNs): new connections
  // are spread over the profile's internets by weight, through a server or
  // direct. Same field as Multi Internet (network_interfaces); two or more
  // internets turn it on, none is off.
  const isLoadBalanceProfile = computed(() => {
    const flags = profile.flags;
    return (
      (flags & ProfileFlag.HIGH_TRAFFIC) !== 0 &&
      (flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET | ProfileFlag.PREVENT_DISCONNECT)) === 0
    );
  });
  // network_interfaces: empty or "*" = the Load balance internets from the
  // Multi Internet page (the default), "-" = off, names = the profile's own.
  const LOAD_BALANCE_POOL = "*";
  const LOAD_BALANCE_OFF = "-";
  const balanceMarkers = [LOAD_BALANCE_POOL, LOAD_BALANCE_OFF];
  const { loadBalance: loadBalancePool, isMetered } = useNetworkAdapterSettings();
  const balancePicked = computed(() => ownInternets.value.filter((n) => !balanceMarkers.includes(n)));
  const balanceMode = computed<LoadBalanceMode>(() => {
    if (ownInternets.value.includes(LOAD_BALANCE_OFF)) return "off";
    return balancePicked.value.length > 0 ? "pick" : "pool";
  });
  const presentAdapters = computed(() => splitAdapters.value.filter((n) => !sel.orphanedInterfaces.value.includes(n)));
  /** Every internet that can be load balanced (metered ones never are). */
  const balanceAdapters = computed(() => splitAdapters.value.filter((n) => !isMetered(n)));
  /** Ticked: the profile's own internets, or the ones flagged Load balance on
   * the Multi Internet page while it has none of its own. */
  const balanceSelected = computed(() =>
    balanceMode.value === "pick"
      ? balancePicked.value
      : loadBalancePool.selection.value.filter((n) => presentAdapters.value.includes(n) && !isMetered(n)),
  );
  const balanceOn = computed(() => balanceMode.value !== "off" && balanceSelected.value.length > 1);
  function setBalanceMode(next: LoadBalanceMode) {
    if (next === balanceMode.value) return;
    setOwnInternets(next === "off" ? [LOAD_BALANCE_OFF] : []);
  }
  /** Ticking an internet makes the ticked ones the profile's own; unticking
   * down to one turns load balancing off on that one. */
  function pickBalanceInternet(name: string) {
    const current = balanceSelected.value;
    const next = current.includes(name) ? current.filter((n) => n !== name) : [...current, name];
    if (next.length >= 2) setOwnInternets(next);
    else if (next.length === 1) pickSingleBalance(next[0]);
  }
  /** How many internets the Multi Internet page flags for load balancing
   * (connected, not metered): two or more and following it balances. */
  const balancePoolCount = computed(
    () => loadBalancePool.selection.value.filter((n) => presentAdapters.value.includes(n) && !isMetered(n)).length,
  );
  /** Back to the settings: nothing of its own for its internets (the
   * profile follows its game, the game the settings). */
  function followBalanceSettings() {
    if (title) {
      const st = title.state() as Partial<TitleState> | undefined;
      if (!st) return;
      st.default_interface = null as unknown as string;
      st.network_interfaces = [];
      changed();
      return;
    }
    void store.followTitle(profile.id, ["internet"]);
  }
  /** Off on one internet: Go balances only over two or more, else it uses the
   * profile's Default, so the one internet is that Default. */
  function pickSingleBalance(name: string) {
    setSplitAdapter(name);
    setOwnInternets([LOAD_BALANCE_OFF]);
  }
  // A Dedicated IP is one tunnel on one internet: load balancing is off and
  // one internet is picked (the core ignores load balancing for it too).
  const { summary: profileWireGuard } = useProfileWireGuard(profile.id);
  const dedicatedIpOn = computed(() => profileWireGuard.value.enabled && !!profileWireGuard.value.selected);
  const { settings, setLoadBalanceWeight } = useSettings();
  // Each internet's weight and share, while the menu is open.
  const balanceShares = ref<Record<string, LoadBalanceShare>>({});
  async function refreshBalanceShares() {
    if (!balanceOn.value) return;
    try {
      const names = balanceSelected.value;
      const list = (await GetLoadBalanceShares(names)) ?? [];
      balanceShares.value = Object.fromEntries(list.map((share) => [share.name, share]));
    } catch {
      // service not running yet
    }
  }
  let sharesTimer: ReturnType<typeof setInterval> | undefined;
  watch(
    () => toValue(live) && isLoadBalanceProfile.value && balanceOn.value,
    (live) => {
      clearInterval(sharesTimer);
      if (!live) return;
      void refreshBalanceShares();
      sharesTimer = setInterval(refreshBalanceShares, 2000);
    },
    { immediate: true },
  );
  watch(() => [...ownInternets.value, JSON.stringify(settings.value.loadBalanceWeights ?? {})].join("|"), () => {
    void refreshBalanceShares();
  });
  onBeforeUnmount(() => clearInterval(sharesTimer));

  return {
    splitAdapter,
    splitAdapters,
    setSplitAdapter,
    toggleSplitTunnel,
    isMultiInternetProfile,
    ownInternets,
    multiOn,
    multiInherited,
    multiSelected,
    toggleMultiInternet,
    pickInternet,
    isLoadBalanceProfile,
    balanceMode,
    balanceAdapters,
    balanceSelected,
    balanceOn,
    setBalanceMode,
    pickBalanceInternet,
    pickSingleBalance,
    balancePoolCount,
    followBalanceSettings,
    dedicatedIpOn,
    settings,
    setLoadBalanceWeight,
    balanceShares,
    adapterIcon,
  };
}
