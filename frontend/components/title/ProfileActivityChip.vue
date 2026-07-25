<script setup lang="ts">
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import { ProfileFlag } from "~/constants/profile";
import { useHumanSize, useHumanSpeed } from "~/composables/helper";
import { useProfileConnectionStats } from "~/composables/useProfileConnectionStats";

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
} = useProfileConnectionStats(() => props.profile.id);

/** High-traffic: always while the profile is on. Others: when connected. */
const visible = computed(() => {
  if (!profileActive.value || !store.appReady) {
    return false;
  }
  if (isHighTraffic.value) {
    return true;
  }
  return connected.value;
});
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
      <span class="profile-activity__meta text-caption text-no-wrap">
        <span>↓ {{ useHumanSpeed(downloadSpeed) }}</span>
        <span class="profile-activity__sep">·</span>
        <span>↑ {{ useHumanSpeed(uploadSpeed) }}</span>
        <template v-if="totalBytes > 0">
          <span class="profile-activity__sep">·</span>
          <span class="profile-activity__usage">{{
            useHumanSize(totalBytes)
          }}</span>
        </template>
      </span>
    </template>

    <span
      v-else-if="totalBytes > 0"
      class="profile-activity__meta text-caption text-no-wrap"
    >
      {{ useHumanSize(totalBytes) }}
    </span>
  </div>
</template>

<style scoped>
.profile-activity {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  max-width: min(280px, 48vw);
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

.profile-activity__usage {
  opacity: 0.72;
}
</style>
