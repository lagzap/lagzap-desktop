<script lang="ts" setup>
import { useLocale } from 'vuetify'
import type {
  RouteAccuracySetting,
  RouteIPSetting,
  RouteProtocolSetting,
} from '~/composables/useSettings'

const locale = useLocale()
const { t } = locale

const {
  settings,
  setRouteAccuracy,
  setRouteProtocol,
  setRouteIp,
  setRealtimeOptimization,
  getRouteAccuracyOptions,
  getRouteProtocolOptions,
  getRouteIpOptions,
} = useSettings(locale)

const accuracyItems = computed(() =>
  getRouteAccuracyOptions().map((item) => ({
    value: item.value,
    text: t(`$vuetify.settings.route.accuracy.${item.value}`),
  }))
)

const protocolItems = computed(() =>
  getRouteProtocolOptions().map((item) => ({
    value: item.value,
    title: t(`$vuetify.settings.route.protocol.${item.value}`),
  }))
)

const ipItems = computed(() =>
  getRouteIpOptions().map((item) => ({
    value: item.value,
    title: t(`$vuetify.settings.route.ip.${item.value}`),
  }))
)
</script>

<template>
  <v-card
    :title="t('$vuetify.settings.route.routeSettings')"
    flat
    class="mt-3 bg-transparent"
    max-width="500"
  >
    <v-card-text class="pb-0">
      <v-card-subtitle class="px-0 my-3">
        {{ t('$vuetify.settings.route.routeOptimizationAccuracy') }}
      </v-card-subtitle>
      <v-select
        :model-value="settings.routeAccuracy"
        :items="accuracyItems"
        item-value="value"
        item-title="text"
        :label="t('$vuetify.settings.route.accuracy.label')"
        density="comfortable"
        variant="outlined"
        @update:model-value="setRouteAccuracy($event as RouteAccuracySetting)"
      />
      <v-card-subtitle class="px-0 my-3">
        {{ t('$vuetify.settings.route.optimizeProtocol') }}
      </v-card-subtitle>
      <v-row dense>
        <v-col>
          <v-select
            :model-value="settings.routeProtocol"
            :items="protocolItems"
            item-value="value"
            item-title="title"
            :label="t('$vuetify.settings.route.networkProtocol')"
            density="comfortable"
            variant="outlined"
            class="mb-4"
            @update:model-value="setRouteProtocol($event as RouteProtocolSetting)"
          />
        </v-col>
        <v-col>
          <v-select
            :model-value="settings.routeIp"
            :items="ipItems"
            item-value="value"
            item-title="title"
            :label="t('$vuetify.settings.route.ipVersion')"
            density="comfortable"
            variant="outlined"
            class="mb-4"
            @update:model-value="setRouteIp($event as RouteIPSetting)"
          />
        </v-col>
      </v-row>
      <v-switch
        inset
        :model-value="settings.realtimeOptimization"
        :label="t('$vuetify.settings.route.realTimeOptimization')"
        @update:model-value="setRealtimeOptimization(!!$event)"
      />
    </v-card-text>
  </v-card>
</template>
