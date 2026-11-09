<script setup lang="ts">
import { computed, ref } from "vue";
import CountryFlag from "vue-country-flag-next";
import { useLocale } from "vuetify";
import { useStore } from "@/stores";

/** The connection LagZap sees for this account: public IP (hidden until
 * asked, it is often on screen while streaming), ISP and location. */
const { t } = useLocale();
const store = useStore();
const info = computed(() => store.clientInfo);

const showIp = ref(false);
const location = computed(() =>
  [info.value?.City, info.value?.Region, info.value?.Country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", "),
);
const countryCode = computed(() => (/^[A-Za-z]{2}$/.test(info.value?.Country ?? "") ? info.value!.Country : ""));
</script>

<template>
  <section class="lz-panel">
    <div class="lz-panel__head">
      <v-icon icon="mdi-web" size="20" color="primary" />
      <span class="text-subtitle-1 font-weight-medium">{{ t("$vuetify.profile.connection") }}</span>
    </div>

    <div v-if="info" class="lz-metrics lz-metrics--wide">
      <div class="lz-metric">
        <span class="lz-label">{{ t("$vuetify.profile.publicIp") }}</span>
        <span class="lz-metric__value d-flex align-center ga-1">
          <span dir="ltr" :class="{ 'connection__ip--hidden': !showIp }">{{ info.IP || "—" }}</span>
          <v-btn
            v-if="info.IP"
            :icon="showIp ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
            :aria-label="showIp ? t('$vuetify.profile.hideIp') : t('$vuetify.profile.showIp')"
            size="x-small"
            variant="text"
            @click="showIp = !showIp"
          />
        </span>
      </div>
      <div class="lz-metric">
        <span class="lz-label">{{ t("$vuetify.profile.isp") }}</span>
        <span class="lz-metric__value text-truncate">{{ info.ISP || "—" }}</span>
      </div>
      <div class="lz-metric">
        <span class="lz-label">{{ t("$vuetify.profile.location") }}</span>
        <span class="lz-metric__value d-flex align-center ga-1 min-w-0">
          <CountryFlag v-if="countryCode" :country="countryCode" size="small" />
          <span class="text-truncate">{{ location || "—" }}</span>
        </span>
      </div>
    </div>
    <div v-else class="text-body-2 text-medium-emphasis">{{ t("$vuetify.profile.connectionPending") }}</div>
  </section>
</template>

<style scoped>
.connection__ip--hidden {
  filter: blur(5px);
  user-select: none;
}
</style>
