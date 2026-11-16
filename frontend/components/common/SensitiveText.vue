<script setup lang="ts">
import { ref } from "vue";
import { useLocale } from "vuetify";
import { maskSensitive } from "~/utils/privacy";

/** Personal data (email, phone, IP) shown as stars until clicked: streamers keep
 * the app on screen, and nothing personal may show without them asking. */
defineProps<{ text: string }>();

const { t } = useLocale();
const shown = ref(false);
</script>

<template>
  <v-tooltip :text="shown ? t('$vuetify.privacy.clickToHide') : t('$vuetify.privacy.clickToShow')" location="top" open-delay="300">
    <template #activator="{ props: tip }">
      <span
        v-bind="tip"
        class="sensitive-text"
        dir="ltr"
        @click.stop="shown = !shown"
      >{{ shown ? text : maskSensitive(text) }}</span>
    </template>
  </v-tooltip>
</template>

<style scoped>
.sensitive-text {
  cursor: pointer;
  border-radius: 4px;
}
</style>
