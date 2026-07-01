<script lang="ts" setup>
const store = useStore();

// Props
const props = withDefaults(
  defineProps<{
    loading?: boolean;
  }>(),
  {
    loading: true,
  }
);

</script>

<template>
  <div class="animated-logo-container">
    <!-- Glowing logo in center with orbital particles -->
    <div class="logo-container">
      <v-img src="~/assets/svgs/cyrex.svg" alt="Cyrex" :class="{
        'animated-logo': loading
      }" />
    </div>
  </div>
</template>

<style>
.animated-logo-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: transparent;
  overflow: hidden;
  pointer-events: none;
  z-index: 1000;
}

.logo-container {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 150px;
  height: 150px;
  z-index: 1001;
}

.animated-logo {
  width: 100%;
  height: 100%;
  animation: logoGlow 3s ease-in-out infinite alternate;
  filter: drop-shadow(0 0 20px rgba(239, 230, 148, 0.2));
}

@keyframes logoGlow {
  0% {
    filter: drop-shadow(0 0 20px rgba(239, 230, 148, 0.2));
    transform: scale(1);
  }

  100% {
    filter: drop-shadow(0 0 40px rgba(239, 230, 148, 0.3));
    transform: scale(1.05);
  }
}
</style>
