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
/** Games show live speeds; other profiles only how much they used. */
const isGame = computed(
  () => (props.profile.flags & (ProfileFlag.MULTIPATH | ProfileFlag.GAME_PACKET)) !== 0
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
    :class="{ 'profile-activity--live': connected }"
  >
    <template v-if="isHighTraffic && isGame">
      <span class="profile-activity__meta text-caption text-no-wrap">
        <span class="profile-activity__down"
          ><v-icon icon="mdi-arrow-down" size="12" class="profile-activity__arrow" />{{ useHumanSpeed(downloadSpeed) }}</span
        >
        <span class="profile-activity__sep">·</span>
        <span class="profile-activity__up"
          ><v-icon icon="mdi-arrow-up" size="12" class="profile-activity__arrow" />{{ useHumanSpeed(uploadSpeed) }}</span
        >
        <template v-if="totalBytes > 0">
          <span class="profile-activity__sep">·</span>
          <span
            class="profile-activity__usage"
            :class="{ 'profile-activity__usage--link': clickable }"
            :role="clickable ? 'button' : undefined"
            :tabindex="clickable ? 0 : undefined"
            @click.stop="clickable && emit('click')"
            @keydown.enter="clickable && emit('click')"
          >{{ useHumanSize(totalBytes) }}</span>
        </template>
      </span>
    </template>

    <span
      v-else
      class="profile-activity__meta text-caption text-no-wrap"
    >
      <span
        class="profile-activity__usage"
        :class="{ 'profile-activity__usage--link': clickable }"
        :role="clickable ? 'button' : undefined"
        :tabindex="clickable ? 0 : undefined"
        @click.stop="clickable && emit('click')"
        @keydown.enter="clickable && emit('click')"
      >{{ useHumanSize(totalBytes) }}</span>
    </span>
  </span>
</template>

<style scoped>
/* Only the used traffic opens the traffic chart. */
.profile-activity__usage--link {
  cursor: pointer;
  text-underline-offset: 3px;
}

.profile-activity__usage--link:hover,
.profile-activity__usage--link:focus-visible {
  text-decoration: underline;
  opacity: 1;
}

.profile-activity {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: min(280px, 48vw);
  color: rgba(var(--v-theme-on-surface), 0.7);
  vertical-align: middle;
}

.profile-activity__arrow {
  margin-inline-end: 1px;
  vertical-align: -1px;
  opacity: 0.7;
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

.profile-activity__down,
.profile-activity__up {
  color: rgba(var(--v-theme-on-surface), 0.87);
}

.profile-activity__usage {
  opacity: 0.72;
}
</style>
