<template>
  <Transition name="particle-fade">
    <div
      v-if="showParticles"
      class="optimize-particles"
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
        style="
          position: relative;
          width: 100%;
          height: 100%;
          background: radial-gradient(
            ellipse at center bottom,
            rgba(255, 140, 0, 0.1) 0%,
            transparent 50%
          );
        "
      />
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { useStore } from "~/stores";
import { useMonitoringStore } from "~/stores/monitoring";

const store = useStore();
const monitoringStore = useMonitoringStore();
const particleContainer = ref<HTMLElement>();
const particles = ref<HTMLElement[]>([]);
const isAnimating = ref(true);
const animationFrameId = ref<number | null>(null);

const showParticles = computed(() => {
  const hasOptimizeProgress = store.optimizeProgress && !store.optimizeProgress.is_complete;
  const hasActiveConnections = monitoringStore.connections.value && monitoringStore.connections.value.length > 0;
  
  // Don't show particles if there are active connections
  return hasOptimizeProgress && !hasActiveConnections;
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

const size = ref(8); // Set to 8 as requested

// Particle colors - EXACT from HTML
const colors = [
  "#ff8c00", // Dark orange
  "#ffa500", // Orange
  "#ffb347", // Light orange
  "#ffd700", // Gold
  "#ffed4e", // Yellow
  "#ffeb3b", // Bright yellow
  "#ffc107", // Amber
  "#ff9800", // Orange
  "#ff6f00", // Dark orange
  "#ffab00", // Amber yellow
];

function createParticle() {
  if (!particleContainer.value) {
    return;
  }

  // Don't create particles if there are active connections
  if (monitoringStore.connections.value && monitoringStore.connections.value.length > 0) {
    return;
  }


  const particle = document.createElement("div");
  particle.className = "particle";

  const color = colors[Math.floor(Math.random() * colors.length)];
  const particleSize = Math.random() * size.value + 1;
  const x = Math.random() * window.innerWidth;

  // Generate random drift amounts for smooth horizontal movement
  const maxDrift = window.innerWidth * 0.15; // Max 15% of screen width drift
  const drift1 = (Math.random() - 0.5) * maxDrift * 0.9;
  const drift2 = (Math.random() - 0.5) * maxDrift * 0.6;

  // Random disappear height - particles can disappear anywhere from 20% to 100% of screen height
  // Since particles start at top: 100vh, we use negative values to move them up
  const minDisappearHeight = -(window.innerHeight * 0.8); // 80% up from bottom
  const maxDisappearHeight = -(window.innerHeight * 1.1); // 10% above screen
  const disappearHeight =
    minDisappearHeight +
    Math.random() * (maxDisappearHeight - minDisappearHeight);

  // Random velocity (duration affects speed)
  const baseDuration = 1 + Math.random() * 3; // 4-13 seconds
  const duration = baseDuration / animationSpeed.value;

  particle.style.position = "absolute"; // FIX: Set position to absolute
  particle.style.left = x + "px";
  particle.style.top = "100vh"; // Start from bottom of screen - EXACT LIKE HTML
  particle.style.width = particleSize + "px";
  particle.style.height = particleSize + "px";
  particle.style.background = color;
  particle.style.boxShadow = `0 0 ${particleSize * 3}px ${color}, 0 0 ${
    particleSize * 4
  }px ${color}`;
  particle.style.borderRadius = "50%"; // Make it circular
  particle.style.pointerEvents = "none"; // Don't interfere with clicks
  particle.style.opacity = "0"; // Start invisible
  particle.style.transform = "scale(0)"; // Start small

  // Apply single animation with both vertical and horizontal movement
  particle.style.animation = `floatUp ${duration}s ease-out`;

  // Add event listener to clean up when animation ends
  particle.addEventListener("animationend", () => {
    if (particle.parentNode) {
      particle.parentNode.removeChild(particle);
      const index = particles.value.indexOf(particle);
      if (index > -1) {
        particles.value.splice(index, 1);
      }
    }
  });

  // Set CSS custom properties for drift amounts and disappear height
  particle.style.setProperty("--drift-1", drift1 + "px");
  particle.style.setProperty("--drift-2", drift2 + "px");
  particle.style.setProperty("--disappear-height", disappearHeight + "px");

  particleContainer.value.appendChild(particle);
  particles.value.push(particle);

  // Remove particle after animation completes
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
  // Don't start if already animating
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
    
    // Continue animating only if still active
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
  // Smooth fade out existing particles
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

// Initialize on mount
onMounted(() => {
  if (showParticles.value) {
    isAnimating.value = true;
    startAnimation();
  }
});

// Watch for changes in showParticles
watch(showParticles, (show) => {
  if (show) {
    isAnimating.value = true;
    startAnimation();
  } else {
    stopAnimation();
    clearParticles();
  }
});

// Cleanup on unmount
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
  border-radius: 50%;
  background: inherit;
  filter: blur(15px);
  opacity: 0.3;
}

/* Particle container fade transitions */
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
