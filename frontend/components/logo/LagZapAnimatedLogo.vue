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

const particles = ref<HTMLElement[]>([]);

const createOrbitalParticles = () => {
  if (!props.loading) return;

  const logoContainer = document.querySelector(".logo-container");
  if (!logoContainer) return;

  // Create 8 orbital particles around the logo
  for (let i = 0; i < 4; i++) {
    createOrbitalParticle(i, 4, logoContainer);
  }
};

const createOrbitalParticle = (
  index: number,
  total: number,
  logoContainer: Element
) => {
  const particle = document.createElement("div");
  particle.classList.add("orbital-particle");

  // Particle colors (amber/yellow/orange)
  const colors = [
    "#ffd700", // Gold
    "#ffb347", // Light orange
    "#ffc107", // Amber
    "#ff8f00", // Dark amber
    "#ffab00", // Amber yellow
  ];

  const color = colors[Math.floor(Math.random() * colors.length)];
  const size = Math.random() * 2 + 2; // 2-8px (more size variation)
  const orbitRadius = 60 + Math.random() * 80; // 60-140px orbit radius (more variation)
  const duration = 4 + Math.random() * 12; // 4-16 seconds (more speed variation)
  const direction = Math.random() > 0.5 ? "orbit" : "orbitReverse";

  // Random starting angle for each particle
  const startAngle = Math.random() * 360;

  particle.style.width = size + "px";
  particle.style.height = size + "px";
  particle.style.background = color;
  particle.style.boxShadow = `0 0 ${size * 2}px ${color}`;
  particle.style.top = "50%";
  particle.style.left = "50%";
  particle.style.transform = "translate(-50%, -50%)";

  // Set orbit radius, starting angle, and animation
  particle.style.setProperty("--orbit-radius", orbitRadius + "px");
  particle.style.setProperty("--start-angle", startAngle + "deg");
  particle.style.animation = `${direction} ${duration}s linear infinite`;
  particle.style.animationDelay = Math.random() * 3 + "s"; // Random delay 0-3 seconds

  logoContainer.appendChild(particle);
  particles.value.push(particle);
};

// Watch for loading prop changes
watch(
  () => props.loading,
  (newLoading) => {
    if (newLoading) {
      createOrbitalParticles();
    } else {
      // Remove all particles when loading becomes false
      particles.value.forEach((particle) => {
        if (particle.parentNode) {
          particle.parentNode.removeChild(particle);
        }
      });
      particles.value = [];
    }
  },
  { immediate: true }
);

onMounted(() => {
  if (props.loading) {
    createOrbitalParticles();
  }
});

onUnmounted(() => {
  particles.value.forEach((particle) => {
    if (particle.parentNode) {
      particle.parentNode.removeChild(particle);
    }
  });
  particles.value = [];
});
</script>

<template>
  <div class="animated-logo-container">
    <!-- Glowing logo in center with orbital particles -->
    <div class="logo-container">
      <v-img src="~/assets/svgs/lagzap.svg" alt="LagZap" class="animated-logo" />
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
  width: 120px;
  height: 120px;
  z-index: 1001;
}

.animated-logo {
  width: 100%;
  height: 100%;
  animation: logoGlow 3s ease-in-out infinite alternate;
  filter: drop-shadow(0 0 20px rgba(255, 193, 7, 0.5));
}

@keyframes logoGlow {
  0% {
    filter: drop-shadow(0 0 20px rgba(255, 193, 7, 0.5));
    transform: scale(1);
  }
  100% {
    filter: drop-shadow(0 0 40px rgba(255, 193, 7, 0.8));
    transform: scale(1.05);
  }
}

/* Orbital particles */
.orbital-particle {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}

@keyframes orbit {
  0% {
    transform: rotate(var(--start-angle, 0deg)) translateX(var(--orbit-radius))
      rotate(calc(-1 * var(--start-angle, 0deg)));
  }
  100% {
    transform: rotate(calc(360deg + var(--start-angle, 0deg)))
      translateX(var(--orbit-radius))
      rotate(calc(-360deg - var(--start-angle, 0deg)));
  }
}

@keyframes orbitReverse {
  0% {
    transform: rotate(var(--start-angle, 0deg)) translateX(var(--orbit-radius))
      rotate(calc(-1 * var(--start-angle, 0deg)));
  }
  100% {
    transform: rotate(calc(-360deg + var(--start-angle, 0deg)))
      translateX(var(--orbit-radius))
      rotate(calc(360deg - var(--start-angle, 0deg)));
  }
}
</style>
