<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import MiddleEast from "~/components/icons/regions/middle-east.vue";
import Europe from "~/components/icons/regions/europe.vue";
import country from "country-list-js";
import {
  RoutingMode,
  type Node,
} from "~/bindings/github.com/lagzap/lagzap/adapter";
import { useLocale } from "vuetify";

const { t } = useLocale();
const store = useStore();
const route = useRoute();

const profile = computed(() =>
  store.profiles.find((p) => p.id === (route.params.profile as string))
);

const regions = computed(() => Object.values(store.regions));
const areas = computed(() => {
  return Object.values(store.nodes)
    .slice()
    .sort((a, b) => {
      const countryA = country.findByIso2(a.country)?.name || "";
      const countryB = country.findByIso2(b.country)?.name || "";
      return countryA.localeCompare(countryB);
    })
    .reduce((acc, node) => {
      const area = node.country;
      acc[area] = acc[area] || [];
      acc[area].push(node);
      acc[area].sort((a, b) => a.name.localeCompare(b.name));

      return acc;
    }, {} as Record<string, Node[]>);
});

const mode = computed<string>({
  get() {
    const m = store.profileStates[profile.value.id]?.mode;
    switch (m) {
      case RoutingMode.RoutingMode_ROUTING_MODE_REGIONAL:
        return "region";
      case RoutingMode.RoutingMode_ROUTING_MODE_COUNTRY:
        return "country";
      case RoutingMode.RoutingMode_ROUTING_MODE_CITY:
        return "city";
      default:
        return "global";
    }
  },
  set(v: string) {
    if (v === "region") store.profileStates[profile.value.id].mode = RoutingMode.RoutingMode_ROUTING_MODE_REGIONAL;
    else if (v === "country")
      store.profileStates[profile.value.id].mode = RoutingMode.RoutingMode_ROUTING_MODE_COUNTRY;
    else if (v === "city") store.profileStates[profile.value.id].mode = RoutingMode.RoutingMode_ROUTING_MODE_CITY;
    else store.profileStates[profile.value.id].mode = RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL;

    // Clear selections when switching modes to avoid stale values
    if (v !== "region") store.profileStates[profile.value.id].regions = [];
    if (v !== "country") store.profileStates[profile.value.id].countries = [];
    if (v !== "city") store.profileStates[profile.value.id].cities = [];

    store.saveActionProfile(profile.value.id);
  },
});
</script>

<template>
  <v-card-text>
    <v-chip-group v-model="mode" color="accent" class="mb-3" filter mandatory>
      <v-chip v-if="profile.route_action == 'action'" rounded size="large" value="global">
        <span>{{ t("$vuetify.title.profile.server.automatic") }}</span>
      </v-chip>
      <v-chip  v-if="profile.route_action == 'action'" rounded size="large" value="ai" disabled>
        <span>{{ t("$vuetify.title.profile.server.byAI") }}</span>
      </v-chip>
      <v-chip rounded size="large" value="region">
        <span>{{ t("$vuetify.title.profile.server.byRegion") }}</span>
      </v-chip>
      <v-chip rounded size="large" value="country">
        <span>{{ t("$vuetify.title.profile.server.byCountry") }}</span>
      </v-chip>
      <v-chip rounded size="large" value="city" disabled>
        <span>{{ t("$vuetify.title.profile.server.byCity") }}</span>
      </v-chip>
    </v-chip-group>

    <v-slide-y-transition leave-absolute>
      <v-empty-state v-if="mode == 'global'" icon="mdi-earth" class="my-15">
        <template v-slot:media>
          <v-icon color="surface-variant" />
        </template>

        <template v-slot:headline>
          <div class="text-h4 my-2">
            {{ t("$vuetify.title.profile.server.global") }}
          </div>
        </template>

        <template v-slot:title>
          <div class="text-h6">
            {{
              t("$vuetify.title.profile.server.automaticServerSelectionEnabled")
            }}
          </div>
        </template>

        <template v-slot:text>
          <div class="text-medium-emphasis text-caption">
            {{ t("$vuetify.title.profile.server.routingSystemDescription") }}
          </div>
        </template>
      </v-empty-state>
      <v-item-group
        v-else-if="mode == 'region'"
        class="mb-3"
        multiple
        v-model="store.profileStates[profile.id].regions"
      >
        <v-row>
          <v-col>
            <v-item
              v-for="region in regions"
              :key="region.tag"
              :disabled="region.active === false"
              :value="region.tag"
              v-slot="{ isSelected, selectedClass, toggle }"
            >
              <v-card
                class="d-flex flex-col align-center mb-3"
                :variant="isSelected ? 'text' : 'plain'"
                :title="store.localized(region.name)"
                @click="toggle"
              >
                <template #subtitle>
                  <span />
                </template>

                <template #prepend>
                  <v-checkbox :model-value="isSelected" class="me-3" />
                  <v-avatar size="48" class="me-3">
                    <Europe
                      v-if="region.tag == 'eu'"
                      src="~/assets/svgs/regions/europe.svg"
                    />
                    <MiddleEast
                      v-else-if="region.tag == 'me'"
                      src="~/assets/svgs/regions/middle-east.svg"
                    />
                  </v-avatar>
                </template>
              </v-card>
            </v-item>
          </v-col>
        </v-row>
      </v-item-group>
      <v-item-group
        v-else-if="mode == 'country'"
        class="mb-3"
        multiple
        v-model="store.profileStates[profile.id].countries"
      >
        <v-row dense>
          <v-col
            v-for="[area, nodes] in Object.entries(areas)"
            :key="area"
            cols="12"
            md="6"
          >
            <v-item
              :value="area"
              v-slot="{ isSelected, selectedClass, toggle }"
            >
              <v-card density="compact" class="d-flex flex-col" @click="toggle">
                <template #prepend>
                  <v-checkbox
                    :model-value="isSelected"
                    class="my-auto"
                    hide-details
                  />
                  <v-avatar size="32" class="-3">
                    <span style="height: 40px">
                      <CountryFlag :country="area" />
                    </span>
                  </v-avatar>
                </template>

                <template #title>
                  <span class="text-subtitle-1" style="line-height: 2.5;">{{ country.findByIso2(area)?.name }}</span>
                </template>

                <template #subtitle>
                  <span />
                </template>
              </v-card>
            </v-item>
          </v-col>
        </v-row>
      </v-item-group>
    </v-slide-y-transition>
  </v-card-text>
</template>
