<script setup lang="ts">
import TitleIcon from "~/components/title/TitleIcon.vue";
/** A title's icon (a grey LagZap logo while it loads or when missing). */
const props = withDefaults(defineProps<{ image?: string | null; size?: number }>(), {
  image: null,
  size: 32,
});
</script>

<template>
  <span class="title-avatar" :style="{ width: `${props.size}px`, height: `${props.size}px` }">
    <TitleIcon :size="props.size" :image="props.image" />
  </span>
</template>

<style scoped>
.title-avatar {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}
</style>
