<script setup lang="ts">
import logoUrl from "~/assets/svgs/lagzap.svg?url";

/** A title's (or profile's) icon. While it loads, when it fails, or when
 * there is none, a grey LagZap logo in a circle holds its place. */
const props = withDefaults(
  defineProps<{
    image?: string | null;
    size?: number | string;
    /** Corner of a loaded icon (v-avatar rounded); the placeholder is a circle. */
    rounded?: string | boolean;
  }>(),
  { image: null, size: 32, rounded: "lg" },
);

const px = computed(() => {
  const named: Record<string, number> = { "x-small": 24, small: 32, default: 40, large: 48, "x-large": 56 };
  return typeof props.size === "number" ? props.size : (named[props.size] ?? (Number.parseFloat(props.size) || 40));
});
const failed = ref(false);
watch(
  () => props.image,
  () => (failed.value = false),
);
// Quoted: the logo is inlined as a data URL with spaces and quotes, and an
// unquoted url() with those is dropped, leaving a plain grey square.
const logoStyle = computed(() => ({
  "-webkit-mask-image": `url("${logoUrl}")`,
  "mask-image": `url("${logoUrl}")`,
}));
</script>

<template>
  <span class="title-icon" :style="{ width: `${px}px`, height: `${px}px` }">
    <v-avatar v-if="image && !failed" :size="px" :rounded="rounded">
      <v-img :src="image" cover @error="failed = true">
        <template #placeholder>
          <span class="title-icon__placeholder"><span class="title-icon__logo" :style="logoStyle" /></span>
        </template>
      </v-img>
    </v-avatar>
    <span v-else class="title-icon__placeholder" aria-hidden="true">
      <span class="title-icon__logo" :style="logoStyle" />
    </span>
  </span>
</template>

<style scoped>
.title-icon {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
}

/* Grey circle with a grey LagZap logo: a placeholder, not the title. */
.title-icon__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.08);
}

.title-icon__logo {
  width: 58%;
  height: 58%;
  background-color: rgba(var(--v-theme-on-surface), 0.32);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
}
</style>
