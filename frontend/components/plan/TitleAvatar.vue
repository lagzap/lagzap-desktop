<script setup lang="ts">
/** A title's icon. */
const props = withDefaults(defineProps<{ image?: string | null; size?: number }>(), {
  image: null,
  size: 32,
});
</script>

<template>
  <span class="title-avatar" :style="{ width: `${props.size}px`, height: `${props.size}px` }">
    <v-avatar :size="props.size" :image="props.image || undefined" class="rounded-lg" />
  </span>
</template>

<style scoped>
.title-avatar {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}
</style>
