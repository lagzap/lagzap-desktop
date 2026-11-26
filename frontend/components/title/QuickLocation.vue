<script setup lang="ts">
import { useLocale } from "vuetify";
import type { Profile, RelayRoute } from "~/bindings/github.com/lagzap/zap/data";
import { RoutingMode } from "~/bindings/github.com/lagzap/zap/data";
import { useStore } from "@/stores";
import { displayPingMsForRelay } from "~/composables/relayPingDisplay";
import { useRegionSelection } from "~/composables/useRegionSelection";
import { usePlanAccess } from "~/composables/usePlanAccess";
import FlagImg from "~/components/common/FlagImg.vue";
import { countryName } from "~/utils/localeFormat";
import Ping from "~/components/network/Ping.vue";

/* One profile's location in a small chip (shown on a card's hover): a tap
 * picks Fastest or a city; "More options" opens the full selector. */
const props = defineProps<{ profile: Profile }>();
const emit = defineEmits<{ more: []; open: [boolean] }>();

const { t } = useLocale();
const store = useStore();
const plan = usePlanAccess();
const sel = useRegionSelection(props.profile);

const GLOBAL = RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL;
const CITY = RoutingMode.RoutingMode_ROUTING_MODE_CITY;
const COUNTRY = RoutingMode.RoutingMode_ROUTING_MODE_COUNTRY;

const state = computed(() => store.profileStates[props.profile.id]);
/** "auto", a single city's key, "country:xx" for one country, or
 * "several" (more places, a region, a server: set in More options). */
const current = computed(() => {
  const st = state.value;
  const mode = st?.mode ?? GLOBAL;
  if (mode === GLOBAL) return "auto";
  if (mode === CITY && st?.cities?.length === 1 && !st.node_id) return st.cities[0];
  if (mode === COUNTRY && st?.countries?.length === 1 && !st.node_id) return `country:${st.countries[0]}`;
  return "several";
});

/** The ping the list shows for a city (the same as its Ping), to sort by. */
const { routeProbeHistory } = useMonitoringStore();
function bestMs(route: RelayRoute | null): number {
  const ms = route ? displayPingMsForRelay(route.tag, route, routeProbeHistory.value) : null;
  return ms != null && ms > 0 ? ms : Infinity;
}

const cities = computed(() => {
  return Object.keys(sel.cityMap.value)
    .map((key) => {
      const nodes = sel.cityMap.value[key] ?? [];
      const route = sel.lowestPingForCity(key);
      return {
        key,
        label: sel.getCityLabel(key),
        country: nodes[0]?.country ?? "",
        tag: route?.tag ?? "",
        ms: bestMs(route),
      };
    })
    // Every city, by country then city, A to Z: one that cannot connect now
    // says Unavailable instead of its ping.
    .sort((a, b) => countryName(a.country).localeCompare(countryName(b.country)) || a.label.localeCompare(b.label));
});

/** Cities the plan locks: listed after, picking one offers the plans. */
const lockedCities = computed(() =>
  Object.entries(sel.lockedCityMap.value)
    .map(([key, nodes]) => ({ key, label: sel.getCityLabel(key), country: nodes[0]?.country ?? "" }))
    .sort((a, b) => countryName(a.country).localeCompare(countryName(b.country)) || a.label.localeCompare(b.label)),
);

/** The plan gives this profile no server: Fastest has nothing to pick. */
const noServers = computed(() => Object.keys(sel.cityMap.value).length === 0);

const label = computed(() => {
  if (current.value === "auto") return t("$vuetify.title.playFrom.fastestShort");
  if (current.value === "several") return t("$vuetify.title.playFrom.severalPlaces");
  if (current.value.startsWith("country:")) return countryName(current.value.slice(8)) || current.value.slice(8);
  return sel.getCityLabel(current.value);
});
const flag = computed(() => {
  if (current.value === "auto" || current.value === "several") return "";
  if (current.value.startsWith("country:")) return current.value.slice(8);
  return sel.cityMap.value[current.value]?.[0]?.country ?? "";
});

const open = ref(false);
watch(open, (v) => emit("open", v));

function pickFastest() {
  const st = state.value;
  if (!st) return;
  st.node_id = null;
  st.mode = GLOBAL;
  open.value = false;
}

function pickCity(key: string) {
  const st = state.value;
  if (!st) return;
  st.node_id = null;
  st.cities = [key];
  st.mode = CITY;
  open.value = false;
}
</script>

<template>
  <v-menu v-model="open" location="bottom end" max-height="420">
    <template #activator="{ props: menuProps }">
      <v-chip v-bind="menuProps" size="small" class="quick-location" @click.stop>
        <FlagImg v-if="flag" :country="flag" :height="11" class="me-2" />
        <v-icon v-else-if="noServers" icon="mdi-lock-outline" size="14" color="amber" class="me-1" />
        <v-icon v-else :icon="current === 'auto' ? 'mdi-lightning-bolt' : 'mdi-map-marker-multiple-outline'" size="14" class="me-1" />
        {{ label }}
        <v-icon icon="mdi-chevron-down" size="14" class="ms-1" />
      </v-chip>
    </template>
    <v-list density="compact" min-width="260" class="py-1">
      <v-list-item
        :active="current === 'auto'"
        color="primary"
        :prepend-icon="noServers ? 'mdi-lock-outline' : 'mdi-lightning-bolt'"
        :title="t('$vuetify.title.playFrom.fastest')"
        @click="pickFastest"
      />
      <v-list-subheader>{{ t("$vuetify.title.playFrom.orCity") }}</v-list-subheader>
      <v-list-item
        v-for="city in cities"
        :key="city.key"
        :active="current === city.key"
        color="primary"
        @click="pickCity(city.key)"
      >
        <template #prepend>
          <FlagImg v-if="city.country" :country="city.country" :height="12" class="me-3" />
        </template>
        <v-list-item-title>{{ city.label }}</v-list-item-title>
        <template #append>
          <Ping v-if="Number.isFinite(city.ms)" :tag="city.tag" />
          <span v-else class="quick-location__unavailable">{{ t("$vuetify.title.playFrom.unavailable") }}</span>
        </template>
      </v-list-item>
      <v-list-item
        v-for="city in lockedCities"
        :key="city.key"
        class="quick-location__locked"
        @click="open = false; plan.openUpgrade()"
      >
        <template #prepend>
          <FlagImg v-if="city.country" :country="city.country" :height="12" class="me-3" />
        </template>
        <v-list-item-title>{{ city.label }}</v-list-item-title>
        <template #append>
          <v-icon icon="mdi-cart-outline" size="16" color="amber" />
        </template>
      </v-list-item>
      <v-divider class="my-1" />
      <v-list-item
        prepend-icon="mdi-tune-variant"
        append-icon="mdi-chevron-right"
        :title="t('$vuetify.title.playFrom.moreOptions')"
        @click="open = false; emit('more')"
      />
    </v-list>
  </v-menu>
</template>

<style scoped>
.quick-location__unavailable {
  font-size: 0.75rem;
  color: rgb(var(--v-theme-error));
}

.quick-location {
  letter-spacing: normal;
}

.quick-location__locked {
  opacity: 0.6;
}
</style>
