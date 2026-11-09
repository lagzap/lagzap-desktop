<script setup lang="ts">
import { ref } from "vue";
import { useLocale } from "vuetify";

/** Personal data (email, phone, IP) blurred until clicked: streamers keep
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
        :class="{ 'sensitive-text--hidden': !shown }"
        dir="ltr"
        @click.stop="shown = !shown"
      >{{ text }}</span>
    </template>
  </v-tooltip>
</template>

<style scoped>
.sensitive-text {
  cursor: pointer;
  border-radius: 4px;
  transition: filter 0.15s ease;
}

.sensitive-text--hidden {
  filter: blur(5px);
  user-select: none;
}
</style>
