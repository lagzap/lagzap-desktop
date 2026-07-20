<template>
  <Transition name="particle-fade">
    <div
      v-if="showParticles"
      class="optimize-particles"
      :class="{ 'optimize-particles--light': !isDark }"
      style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        z-index: 2147483647;
        pointer-events: none;
        overflow: hidden;
      "
    >
      <div
        ref="particleContainer"
        class="particle-container"
      />
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { useTheme } from "vuetify";
import { useStore } from "~/stores";
import { useMonitoringStore } from "~/stores/monitoring";

const store = useStore();
const monitoringStore = useMonitoringStore();
const theme = useTheme();
const route = useRoute();
const isDark = computed(() => theme.current.value.dark);
const particleContainer = ref<HTMLElement>();
const particles = ref<HTMLElement[]>([]);
const isAnimating = ref(true);
const animationFrameId = ref<number | null>(null);

const onSplash = computed(() => {
  const name = String(route.name ?? "");
  const path = route.path || "";
  return (
    route.meta.layout === "start" ||
    path.startsWith("/start-service") ||
    name === "start-service" ||
    name.endsWith("start-service")
  );
});

const showParticles = computed(() => {
  const hasOptimizeProgress =
    store.optimizeProgress && !store.optimizeProgress.is_complete;
  const hasActiveConnections =
    monitoringStore.connections.value &&
    monitoringStore.connections.value.length > 0;

  // Splash owns its tip-dot sparks — never show float-up particles there.
  if (onSplash.value) {
    return false;
  }

  return !!hasOptimizeProgress && !hasActiveConnections;
});

const particleCount = computed(() => {
  if (!store.optimizeProgress) return 50;
  const completed = store.optimizeProgress.completed_tests;
  return Math.max(10, Math.min(200, completed));
});

const animationSpeed = computed(() => {
  if (!store.optimizeProgress) return 3;
  const progress = store.optimizeProgress.progress;
  return Math.max(1, Math.min(10, Math.round((progress / 100) * 4) + 1));
});

const size = ref(8);

/** Bright sparks for dark UI */
const darkColors = [
  "#ff8c00",
  "#ffa500",
  "#ffb347",
  "#ffd700",
  "#ffed4e",
  "#ffeb3b",
  "#ffc107",
  "#ff9800",
  "#ff6f00",
  "#ffab00",
];

/** Deeper brand ambers — crisp on light backgrounds without muddy bloom */
const lightColors = [
  "#8B6914",
  "#A67C00",
  "#B8860B",
  "#C9A227",
  "#9A7B2F",
  "#B45309",
  "#D97706",
  "#CA8A04",
  "#92400E",
  "#A16207",
];

function createParticle() {
  if (!particleContainer.value) {
    return;
  }

  if (monitoringStore.connections.value && monitoringStore.connections.value.length > 0) {
    return;
  }

  const light = !isDark.value;
  const palette = light ? lightColors : darkColors;
  const particle = document.createElement("div");
  particle.className = light ? "particle particle--light" : "particle";

  const color = palette[Math.floor(Math.random() * palette.length)];
  // Slightly tighter dots on light so they read as sparks, not smudges
  const particleSize = light
    ? Math.random() * (size.value * 0.7) + 1.5
    : Math.random() * size.value + 1;
  const x = Math.random() * window.innerWidth;

  const maxDrift = window.innerWidth * 0.15;
  const drift1 = (Math.random() - 0.5) * maxDrift * 0.9;
  const drift2 = (Math.random() - 0.5) * maxDrift * 0.6;

  const minDisappearHeight = -(window.innerHeight * 0.8);
  const maxDisappearHeight = -(window.innerHeight * 1.1);
  const disappearHeight =
    minDisappearHeight +
    Math.random() * (maxDisappearHeight - minDisappearHeight);

  const baseDuration = 1 + Math.random() * 3;
  const duration = baseDuration / animationSpeed.value;

  particle.style.position = "absolute";
  particle.style.left = x + "px";
  particle.style.top = "100vh";
  particle.style.width = particleSize + "px";
  particle.style.height = particleSize + "px";
  particle.style.background = color;
  if (light) {
    // Soft amber halo — no full-color bloom that turns muddy on white
    particle.style.boxShadow = `0 0 ${particleSize * 1.5}px rgba(184, 134, 11, 0.45)`;
  } else {
    particle.style.boxShadow = `0 0 ${particleSize * 3}px ${color}, 0 0 ${
      particleSize * 4
    }px ${color}`;
  }
  particle.style.borderRadius = "50%";
  particle.style.pointerEvents = "none";
  particle.style.opacity = "0";
  particle.style.transform = "scale(0)";
  particle.style.animation = `floatUp ${duration}s ease-out`;

  particle.addEventListener("animationend", () => {
    if (particle.parentNode) {
      particle.parentNode.removeChild(particle);
      const index = particles.value.indexOf(particle);
      if (index > -1) {
        particles.value.splice(index, 1);
      }
    }
  });

  particle.style.setProperty("--drift-1", drift1 + "px");
  particle.style.setProperty("--drift-2", drift2 + "px");
  particle.style.setProperty("--disappear-height", disappearHeight + "px");

  particleContainer.value.appendChild(particle);
  particles.value.push(particle);

  setTimeout(() => {
    if (particle.parentNode) {
      particle.parentNode.removeChild(particle);
      const index = particles.value.indexOf(particle);
      if (index > -1) {
        particles.value.splice(index, 1);
      }
    }
  }, (duration + 2) * 1000);
}

function startAnimation() {
  if (animationFrameId.value !== null) {
    return;
  }

  const animate = () => {
    if (
      isAnimating.value &&
      showParticles.value &&
      particles.value.length < particleCount.value &&
      (!monitoringStore.connections.value || monitoringStore.connections.value.length === 0)
    ) {
      createParticle();
    }

    if (isAnimating.value && showParticles.value) {
      animationFrameId.value = requestAnimationFrame(animate);
    } else {
      animationFrameId.value = null;
    }
  };
  animationFrameId.value = requestAnimationFrame(animate);
}

function stopAnimation() {
  if (animationFrameId.value !== null) {
    cancelAnimationFrame(animationFrameId.value);
    animationFrameId.value = null;
  }
  isAnimating.value = false;
}

function clearParticles() {
  particles.value.forEach((particle) => {
    if (particle.parentNode) {
      particle.style.transition = "opacity 1s ease-out";
      particle.style.opacity = "0";
      setTimeout(() => {
        if (particle.parentNode) {
          particle.parentNode.removeChild(particle);
        }
      }, 1000);
    }
  });
  particles.value = [];
}

onMounted(() => {
  if (showParticles.value) {
    isAnimating.value = true;
    startAnimation();
  }
});

watch(showParticles, (show) => {
  if (show) {
    isAnimating.value = true;
    startAnimation();
  } else {
    stopAnimation();
    clearParticles();
  }
});

// Theme flip mid-optimize: clear so new particles use the right look
watch(isDark, () => {
  if (showParticles.value) {
    clearParticles();
  }
});

onUnmounted(() => {
  stopAnimation();
  clearParticles();
});
</script>

<style>
@keyframes floatUp {
  0% {
    transform: translateY(0) translateX(0) scale(0);
    opacity: 0;
  }
  10% {
    opacity: 1;
    transform: translateY(-10vh) translateX(var(--drift-1)) scale(0.3);
  }
  100% {
    transform: translateY(var(--disappear-height)) translateX(var(--drift-2))
      scale(1);
    opacity: 0;
  }
}

.particle-container {
  position: relative;
  width: 100%;
  height: 100%;
  background: radial-gradient(
    ellipse at center bottom,
    rgba(255, 140, 0, 0.1) 0%,
    transparent 50%
  );
}

.optimize-particles--light .particle-container {
  /* Warm lift without orange mud on light chrome */
  background: radial-gradient(
    ellipse at center bottom,
    rgba(184, 134, 11, 0.06) 0%,
    transparent 45%
  );
}

.particle {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}

.particle::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: inherit;
  filter: blur(8px);
  opacity: 0.6;
}

.particle::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 100%;
  height: 100%;
  border-radius: 50%;
  background: inherit;
  filter: blur(15px);
  opacity: 0.3;
}

/* Light: sharp core, tiny halo — no big soft blur smudges */
.particle--light::before {
  filter: blur(2px);
  opacity: 0.35;
  width: 140%;
  height: 140%;
}

.particle--light::after {
  display: none;
}

.particle-fade-enter-active {
  transition: opacity 1s ease-in;
}

.particle-fade-leave-active {
  transition: opacity 2s ease-out;
}

.particle-fade-enter-from {
  opacity: 0;
}

.particle-fade-leave-to {
  opacity: 0;
}
</style>
