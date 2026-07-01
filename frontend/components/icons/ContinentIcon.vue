<script setup lang="ts">
import Africa from './regions/africa.vue';
import Asia from './regions/asia.vue';
import Europe from './regions/europe.vue';
import MiddleEast from './regions/middle-east.vue';
import NorthAmerica from './regions/north-america.vue';
import Oceania from './regions/oceania.vue';
import SouthAmerica from './regions/south-america.vue';

defineProps<{
  tag: string;
}>();
</script>

<template>
  <Europe
    v-if="tag == 'eu'"
    src="~/assets/svgs/regions/europe.svg"
  />
  <MiddleEast
    v-else-if="tag == 'me'"
    src="~/assets/svgs/regions/asia.svg"
  />
  <Asia
    v-else-if="tag == 'as'"
    src="~/assets/svgs/regions/asia.svg"
  />
  <Africa
    v-else-if="tag == 'af'"
    src="~/assets/svgs/regions/africa.svg"
  />
  <NorthAmerica
    v-else-if="tag == 'na'"
    src="~/assets/svgs/regions/north_america.svg"
  />
  <SouthAmerica
    v-else-if="tag == 'sa'"
    src="~/assets/svgs/regions/south_america.svg"
  />
  <Oceania
    v-else-if="tag == 'oc'"
    src="~/assets/svgs/regions/oceania.svg"
  />
</template>