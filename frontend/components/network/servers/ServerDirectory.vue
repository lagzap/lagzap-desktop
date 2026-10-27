<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import { useLocale } from "vuetify";
import ContinentIcon from "~/components/icons/ContinentIcon.vue";
import { qualityColor } from "~/composables/useNetworkMonitor";
import { useServerDirectory } from "~/composables/useServerDirectory";

/** Public list of LagZap locations with the ping from your connection.
 * Go measures, labels and sorts; this only renders. */
const { t } = useLocale();
const { directory, iface } = useServerDirectory();

const region = ref("all");
const regions = computed(() => directory.value?.regions ?? []);
const shownRegions = computed(() =>
  region.value === "all" ? regions.value : regions.value.filter((r) => r.tag === region.value)
);
watch(regions, (list) => {
  if (region.value !== "all" && !list.some((r) => r.tag === region.value)) region.value = "all";
});

const STATUS_COLOR: Record<string, string> = {
  online: "success",
  busy: "warning",
  unreachable: "error",
  not_measured: "grey",
};

function openCity(key: string) {
  navigateTo({ name: "monitoring-location-key", params: { key } });
}
</script>

<template>
  <section>
    <div class="d-flex flex-wrap align-center ga-3 mb-1">
      <div>
        <div class="text-subtitle-1 font-weight-medium">
          {{ t("$vuetify.networkLatency.servers.title") }}
        </div>
        <div class="text-caption text-medium-emphasis">
          {{ t("$vuetify.networkLatency.servers.subtitle") }}
        </div>
      </div>
      <v-spacer />
      <v-chip-group
        v-if="(directory?.interfaces?.length ?? 0) > 1"
        v-model="iface"
        mandatory
        selected-class="text-primary"
      >
        <v-chip value="" variant="tonal" size="small" filter>
          {{ t("$vuetify.networkLatency.servers.bestConnection") }}
        </v-chip>
        <v-chip
          v-for="name in directory?.interfaces ?? []"
          :key="name"
          :value="name"
          variant="tonal"
          size="small"
          filter
        >
          {{ name }}
        </v-chip>
      </v-chip-group>
    </div>

    <v-chip-group v-model="region" mandatory selected-class="text-primary" show-arrows class="mb-2">
      <v-chip value="all" variant="tonal" filter>
        {{ t("$vuetify.network.allRegions") }}
      </v-chip>
      <v-chip
        v-for="r in regions"
        :key="r.tag"
        :value="r.tag"
        :disabled="r.disabled"
        variant="tonal"
        filter
      >
        <template #prepend>
          <v-avatar size="20" class="me-2"><ContinentIcon :tag="r.tag" /></v-avatar>
        </template>
        {{ r.name }}
        <span v-if="r.ping" class="ms-2 text-caption" :class="`text-${qualityColor(r.quality)}`">
          {{ formatMs(r.ping) }}
        </span>
      </v-chip>
    </v-chip-group>

    <template v-for="r in shownRegions" :key="r.tag">
      <div class="text-caption text-medium-emphasis text-uppercase region-title mt-3 mb-2">
        {{ r.name }}
      </div>
      <div class="city-grid">
        <button
          v-for="city in r.cities"
          :key="city.key"
          type="button"
          class="city-card"
          :class="{ 'city-card--off': city.status === 'unreachable' }"
          @click="openCity(city.key)"
        >
          <CountryFlag :country="city.country" size="normal" class="city-card__flag" />
          <div class="city-card__body">
            <div class="d-flex align-center ga-1">
              <span class="text-body-1 font-weight-medium text-truncate">{{ city.city }}</span>
              <v-icon
                v-if="city.in_use"
                icon="mdi-transit-connection-variant"
                size="14"
                color="primary"
                :title="t('$vuetify.networkLatency.servers.usedByGames')"
              />
            </div>
            <span class="text-caption" :class="`text-${STATUS_COLOR[city.status] ?? 'grey'}`">
              {{ t(`$vuetify.networkLatency.servers.status.${city.status}`) }}
            </span>
          </div>
          <span
            v-if="city.ping"
            class="city-card__ping text-body-1 font-weight-bold"
            :class="`text-${qualityColor(city.quality)}`"
          >
            {{ localDigits(city.ping) }}<small class="text-caption ms-1">{{ msUnit() }}</small>
          </span>
          <span v-else class="city-card__ping text-caption text-medium-emphasis">—</span>
        </button>
      </div>
    </template>

    <div v-if="directory && !regions.length" class="text-body-2 text-medium-emphasis text-center py-8">
      {{ t("$vuetify.networkLatency.servers.empty") }}
    </div>
  </section>
</template>

<style scoped>
.region-title {
  letter-spacing: 0.06em;
}

.city-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
  gap: 8px;
}

.city-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 12px;
  text-align: start;
  color: inherit;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  transition: background 0.15s ease, transform 0.15s ease;
  cursor: pointer;
}

.city-card:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
  transform: translateY(-1px);
}

.city-card--off {
  opacity: 0.55;
}

.city-card__flag {
  flex: none;
}

.city-card__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.city-card__ping {
  flex: none;
  font-variant-numeric: tabular-nums;
}
</style>
