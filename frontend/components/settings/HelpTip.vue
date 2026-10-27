<script setup lang="ts">
/** "?" in a circle that shows a hint on hover, so explanations stay out of
 * the way until asked for. */
defineProps<{ text: string }>();
</script>

<template>
  <v-tooltip location="top" max-width="320">
    <template #activator="{ props: tipProps }">
      <v-icon
        v-bind="tipProps"
        class="help-tip"
        size="16"
        icon="mdi-help-circle-outline"
        :aria-label="text"
        tabindex="0"
      />
    </template>
    <span>{{ text }}</span>
  </v-tooltip>
</template>

<style scoped>
.help-tip {
  opacity: 0.6;
  cursor: help;
  vertical-align: middle;
  transition: opacity 0.15s;
}

.help-tip:hover,
.help-tip:focus-visible {
  opacity: 1;
}
</style>
