<script setup lang="ts">
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import { ProfileFlag } from "~/constants/profile";
import { useHumanSize, useHumanSpeed } from "~/composables/helper";
import { useProfileConnectionStats } from "~/composables/useProfileConnectionStats";

const props = defineProps<{
  profile: Profile;
  /** Usage opens the profile's traffic (chart below or a popup). */
  clickable?: boolean;
}>();
const emit = defineEmits<{ click: [] }>();

const store = useStore();

const isHighTraffic = computed(
  () => (props.profile.flags & ProfileFlag.HIGH_TRAFFIC) !== 0
);

const profileActive = computed(() => store.isProfileActive(props.profile.id));

const {
  connected,
  downloadSpeed,
  uploadSpeed,
  totalBytes,
} = useProfileConnectionStats(() => props.profile.id);

const hasUsage = computed(
  () =>
    totalBytes.value > 0 ||
    downloadSpeed.value + uploadSpeed.value > 0
);

/** Show while connected with usage. High-traffic also needs real traffic. */
const visible = computed(() => {
  if (!profileActive.value || !store.appReady || !connected.value) {
    return false;
  }
  if (isHighTraffic.value) {
    return hasUsage.value;
  }
  return totalBytes.value > 0;
});
</script>

<template>
  <span
    v-if="visible"
    class="profile-activity"
    :class="{ 'profile-activity--live': connected, 'profile-activity--clickable': clickable }"
    :role="clickable ? 'button' : undefined"
    :tabindex="clickable ? 0 : undefined"
    @click="clickable && emit('click')"
    @keydown.enter="clickable && emit('click')"
  >
    <span class="profile-activity__dot" aria-hidden="true" />

    <template v-if="isHighTraffic">
      <span class="profile-activity__meta text-caption text-no-wrap">
        <span class="profile-activity__down"
          >↓ {{ useHumanSpeed(downloadSpeed) }}</span
        >
        <span class="profile-activity__sep">·</span>
        <span class="profile-activity__up"
          >↑ {{ useHumanSpeed(uploadSpeed) }}</span
        >
        <template v-if="totalBytes > 0">
          <span class="profile-activity__sep">·</span>
          <span class="profile-activity__usage">{{
            useHumanSize(totalBytes)
          }}</span>
        </template>
      </span>
    </template>

    <span
      v-else
      class="profile-activity__meta text-caption text-no-wrap"
    >
      {{ useHumanSize(totalBytes) }}
    </span>
  </span>
</template>

<style scoped>
.profile-activity--clickable {
  cursor: pointer;
}

.profile-activity--clickable:hover .profile-activity__meta {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.profile-activity {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: min(280px, 48vw);
  color: rgba(var(--v-theme-on-surface), 0.7);
  vertical-align: middle;
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

.profile-activity__meta {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.profile-activity__sep {
  opacity: 0.45;
  margin: 0 0.15rem;
}

.profile-activity__down {
  color: #2196f3;
}

.profile-activity__up {
  color: rgb(var(--v-theme-error));
}

.profile-activity__usage {
  opacity: 0.72;
}
</style>
