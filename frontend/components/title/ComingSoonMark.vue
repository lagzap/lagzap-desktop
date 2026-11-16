<script setup lang="ts">
import { useLocale } from "vuetify";

/** Stands in for a title's toggle while it has no profiles yet: a gray
 * clock, not the plan's lock, since no plan unlocks it. */
withDefaults(defineProps<{ size?: number | string }>(), { size: 14 });

const { t } = useLocale();
</script>

<template>
  <v-tooltip :text="t('$vuetify.title.comingSoon')" location="top" open-delay="200">
    <template #activator="{ props: tip }">
      <span v-bind="tip" class="coming-soon-mark" :aria-label="t('$vuetify.title.comingSoon')">
        <v-icon icon="mdi-clock-outline" :size="size" />
      </span>
    </template>
  </v-tooltip>
</template>

<style scoped>
.coming-soon-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  color: rgba(var(--v-theme-on-surface), 0.38);
}
</style>
