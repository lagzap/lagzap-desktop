<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import MiddleEast from "~/components/icons/regions/middle-east.vue";
import Europe from "~/components/icons/regions/europe.vue";
import country from "country-list-js";
import type { Node } from "~/bindings/github.com/lagzap/lagzap/adapter";
import { useLocale } from "vuetify";

const { t } = useLocale();
const store = useStore();
const route = useRoute();

const mode = ref("global");

const profile = computed(() =>
  store.profiles.find((p) => p.id === (route.params.profile as string))
);

const regions = computed(() => store.regions);
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
</script>

<template>
  <v-card-text v-if="profile">
    <v-chip-group v-model="mode" color="primary" class="mb-3" filter mandatory>
      <v-chip rounded size="large" value="global">
        <span>{{ t("$vuetify.server.automatic") }}</span>
      </v-chip>
      <v-chip rounded size="large" value="ai" disabled>
        <span>{{ t("$vuetify.server.byAI") }}</span>
      </v-chip>
      <v-chip rounded size="large" value="region">
        <span>{{ t("$vuetify.server.byRegion") }}</span>
      </v-chip>
      <v-chip rounded size="large" value="country">
        <span>{{ t("$vuetify.server.byCountry") }}</span>
      </v-chip>
      <v-chip rounded size="large" value="city">
        <span>{{ t("$vuetify.server.byCity") }}</span>
      </v-chip>
    </v-chip-group>

    <v-slide-y-transition leave-absolute>
      <v-empty-state v-if="mode == 'global'" icon="mdi-earth" class="my-15">
        <template v-slot:media>
          <v-icon color="surface-variant" />
        </template>

        <template v-slot:headline>
          <div class="text-h4 my-2">
            {{ t("$vuetify.server.global") }}
          </div>
        </template>

        <template v-slot:title>
          <div class="text-h6">
            {{ t("$vuetify.server.automaticServerSelectionEnabled") }}
          </div>
        </template>

        <template v-slot:text>
          <div class="text-medium-emphasis text-caption">
            {{ t("$vuetify.server.routingSystemDescription") }}
          </div>
        </template>
      </v-empty-state>
      <v-item-group v-else-if="mode == 'region'" class="mb-3" mandatory>
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
                  <v-radio :model-value="isSelected" class="me-3" />
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
      <v-item-group v-else-if="mode == 'country'" class="mb-3">
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
                  <v-avatar size="32" class="me-3">
                    <span style="height: 40px">
                      <CountryFlag :country="area" />
                    </span>
                  </v-avatar>
                </template>

                <template #title>
                  {{ country.findByIso2(area)?.name }}
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

    <v-expansion-panels v-if="false" variant="accordion">
      <v-expansion-panel
        v-for="region in regions"
        :key="region.tag"
        :disabled="region.active === false"
      >
        <v-expansion-panel-title disable-icon-rotate>
          <span class="ms-3">
            {{ region.name }}

            <span />
          </span>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <v-list>
            <v-list-group
              v-for="[area, nodes] in Object.entries(areas).filter(
                ([, nodes]) => nodes[0].region === region.tag
              )"
              :key="area"
              :value="area"
            >
              <template v-slot:activator="{ props }">
                <v-list-item
                  v-bind="props"
                  :value="area"
                  lines="two"
                  rounded="lg"
                >
                  <template #prepend>
                    <v-avatar>
                      <span style="height: 40px">
                        <CountryFlag :country="area" />
                      </span>
                    </v-avatar>
                  </template>

                  <template #title>
                    {{ country.findByIso2(area)?.name }}
                  </template>

                  <template #subtitle>
                    <span />
                  </template>
                </v-list-item>
              </template>

              <v-list-item
                v-for="(node, i) in nodes"
                :key="i"
                :title="node.name"
                :value="node.id"
                rounded="lg"
                :lines="false"
              >
                <template #append>
                  <span />
                </template>
              </v-list-item>
            </v-list-group>
          </v-list>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
  </v-card-text>
  <v-card-text v-else>
    <v-empty-state title="Profile could not be found" />
  </v-card-text>
</template>
