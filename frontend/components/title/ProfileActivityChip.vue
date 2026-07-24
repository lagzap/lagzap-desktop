<script setup lang="ts">
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import { ProfileFlag } from "~/constants/profile";
import { useHumanSize, useHumanSpeed } from "~/composables/helper";
import { useProfileConnectionStats } from "~/composables/useProfileConnectionStats";
import ProfileSpeedChart from "~/components/title/ProfileSpeedChart.vue";

const props = defineProps<{
  profile: Profile;
}>();

const store = useStore();

const isHighTraffic = computed(
  () => (props.profile.flags & ProfileFlag.HIGH_TRAFFIC) !== 0
);

const profileActive = computed(() => store.isProfileActive(props.profile.id));

const {
  connected,
  flowing,
  downloadSpeed,
  uploadSpeed,
  totalBytes,
  speedHistory,
} = useProfileConnectionStats(() => props.profile.id);

/** Only show when the profile is on and there is something useful to say. */
const visible = computed(() => {
  if (!profileActive.value || !store.appReady) {
    return false;
  }
  if (isHighTraffic.value) {
    return connected.value || flowing.value;
  }
  return connected.value;
});

const menuOpen = ref(false);
</script>

<template>
  <div
    v-if="visible"
    class="profile-activity"
    :class="{
      'profile-activity--live': connected,
      'profile-activity--flowing': flowing,
    }"
  >
    <span
      class="profile-activity__dot"
      aria-hidden="true"
    />

    <template v-if="isHighTraffic">
      <v-menu
        v-model="menuOpen"
        open-on-hover
        :open-on-click="true"
        :close-on-content-click="false"
        location="bottom end"
        offset="8"
        :open-delay="180"
        :close-delay="120"
      >
        <template #activator="{ props: menuProps }">
          <button
            v-bind="menuProps"
            type="button"
            class="profile-activity__speeds text-caption text-no-wrap"
          >
            <span class="profile-activity__down"
              >↓ {{ useHumanSpeed(downloadSpeed) }}</span
            >
            <span class="profile-activity__sep">·</span>
            <span class="profile-activity__up"
              >↑ {{ useHumanSpeed(uploadSpeed) }}</span
            >
          </button>
        </template>

        <v-card
          class="profile-activity__chart-card"
          rounded="lg"
          elevation="8"
          border
        >
          <ProfileSpeedChart
            v-if="menuOpen"
            :history="speedHistory"
            :download-speed="downloadSpeed"
            :upload-speed="uploadSpeed"
          />
        </v-card>
      </v-menu>
    </template>

    <template v-else-if="totalBytes > 0">
      <span class="profile-activity__meta text-caption text-no-wrap">
        {{ useHumanSize(totalBytes) }}
      </span>
    </template>
  </div>
</template>

<style scoped>
.profile-activity {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  max-width: min(220px, 42vw);
  padding: 0.2rem 0.55rem;
  margin-inline-end: 0.25rem;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.profile-activity__dot {
  flex-shrink: 0;
  width: 0.45rem;
  height: 0.45rem;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.35);
}

.profile-activity--live .profile-activity__dot {
  background: rgb(var(--v-theme-success));
}

.profile-activity--flowing {
  color: rgba(var(--v-theme-on-surface), 0.88);
  border-color: rgba(var(--v-theme-success), 0.28);
  background: rgba(var(--v-theme-success), 0.08);
}

.profile-activity__speeds,
.profile-activity__meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.profile-activity__speeds {
  display: inline-flex;
  align-items: center;
  gap: 0;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
}

.profile-activity__sep {
  opacity: 0.45;
  margin: 0 0.15rem;
}

.profile-activity__down {
  color: inherit;
}

.profile-activity__up {
  opacity: 0.85;
}

.profile-activity__chart-card {
  background: rgb(var(--v-theme-surface));
  overflow: hidden;
}
</style>
