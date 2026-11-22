<script setup lang="ts">
import type { Title } from "~/bindings/github.com/lagzap/zap/data";
import { useLocale } from "vuetify";
import { useMonitoringStore } from "~/stores/monitoring";
import { usePlanAccess } from "~/composables/usePlanAccess";
import PlanLock from "~/components/plan/PlanLock.vue";
import ComingSoonMark from "~/components/title/ComingSoonMark.vue";
import TitleGamePing from "~/components/title/TitleGamePing.vue";
import { ProfileFlag } from "~/constants/profile";
import { uniqueFlowStats } from "~/composables/useProfileConnectionStats";
import { formatSpeedShort } from "~/utils/localeFormat";

const props = defineProps<{
  title: Title;
}>();

const store = useStore();
const { titleUnavailable } = usePlanAccess();
const { t } = useLocale();
const { connections } = useMonitoringStore();

/** Same filter as the Connections page — count rows, not deduped multipath flows. */
const titleConnections = computed(() =>
  (connections.value ?? []).filter(
    (connection) =>
      connection.title_id === props.title.id && connection.profile_id != ""
  )
);

const connectionCount = computed(() => titleConnections.value.length);

const showConnectionChip = computed(() => connectionCount.value > 0);

const titleIsOn = computed(() => store.isTitleActive(props.title.id));

const profileBreakdown = computed(() => {
  const counts = new Map<string, number>();
  for (const connection of titleConnections.value) {
    const key = connection.profile_id || "";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const rows: { id: string; name: string; count: number }[] = [];
  for (const [profileId, count] of counts) {
    if (count <= 0) {
      continue;
    }
    const profile = profileId
      ? store.profiles.find((entry) => entry.id === profileId)
      : undefined;
    rows.push({
      id: profileId || "other",
      name: profile
        ? store.localized(profile.name)
        : t("$vuetify.connections.otherProfile"),
      count,
    });
  }

  rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return rows;
});

// While the game itself is connected (a connection of a profile flagged
// both game packets and multipath), the chip shows the game's own ping
// instead of the connection count, colored like the route diagram. With
// several such profiles, the one moving the most traffic.
const GAME_FLAGS = ProfileFlag.GAME_PACKET | ProfileFlag.MULTIPATH;
const isGameProfile = (profileId: string) =>
  ((store.profiles.find((profile) => profile.id === profileId)?.flags ?? 0) & GAME_FLAGS) === GAME_FLAGS;
// Sticky: the game profile picked stays while it has a connection, so the
// chip never swaps between profiles (or back to the count) as speeds move.
const playingProfile = ref("");
let dropTimer: ReturnType<typeof setTimeout> | undefined;
watchEffect(() => {
  const games = new Map<string, number>();
  for (const connection of titleConnections.value) {
    const id = connection.profile_id ?? "";
    if (!id || !isGameProfile(id)) continue;
    const speed = (connection.upload_speed ?? 0) + (connection.download_speed ?? 0);
    games.set(id, (games.get(id) ?? 0) + speed);
  }
  if (games.has(playingProfile.value)) {
    clearTimeout(dropTimer);
    dropTimer = undefined;
    return;
  }
  let best = "";
  let bestSpeed = -1;
  for (const [id, speed] of games) {
    if (speed > bestSpeed) [best, bestSpeed] = [id, speed];
  }
  if (best) {
    clearTimeout(dropTimer);
    dropTimer = undefined;
    playingProfile.value = best;
  } else if (playingProfile.value && !dropTimer) {
    // The game left the list: keep its ping a few seconds, a refresh
    // between two lists must not drop it.
    dropTimer = setTimeout(() => {
      dropTimer = undefined;
      playingProfile.value = "";
    }, 5000);
  }
});
onUnmounted(() => clearTimeout(dropTimer));
const gamePing = ref<number | null>(null);

// While a High traffic profile (downloads, updates) is downloading, the chip
// shows its download speed; the tooltip each one's speeds and, when it is
// load balanced, how its download splits over the internets.
const DOWNLOADING_MIN = 32 * 1024; // B/s
const highTrafficIds = computed(
  () =>
    new Set(
      store.profiles
        .filter((profile) => profile.title_id === props.title.id && (profile.flags & ProfileFlag.HIGH_TRAFFIC) !== 0)
        .map((profile) => profile.id),
    ),
);
const downloads = computed(() => {
  const byProfile = new Map<string, typeof titleConnections.value>();
  for (const connection of titleConnections.value) {
    const id = connection.profile_id ?? "";
    if (!highTrafficIds.value.has(id)) continue;
    byProfile.set(id, [...(byProfile.get(id) ?? []), connection]);
  }
  const rows = [];
  for (const [id, list] of byProfile) {
    const stats = uniqueFlowStats(list);
    if (stats.downloadSpeed + stats.uploadSpeed <= 0) continue;
    const perInternet = new Map<string, number>();
    for (const connection of list) {
      if (!connection.iface) continue;
      perInternet.set(connection.iface, (perInternet.get(connection.iface) ?? 0) + (connection.download_speed || 0));
    }
    const total = [...perInternet.values()].reduce((a, b) => a + b, 0);
    const shares =
      perInternet.size > 1 && total > 0
        ? [...perInternet]
            .map(([name, speed]) => ({ name, share: Math.round((speed / total) * 100) }))
            .sort((a, b) => b.share - a.share)
        : [];
    const profile = store.profiles.find((entry) => entry.id === id);
    rows.push({
      id,
      name: profile ? store.localized(profile.name) : id,
      down: stats.downloadSpeed,
      up: stats.uploadSpeed,
      shares,
    });
  }
  return rows.sort((a, b) => b.down - a.down);
});
const downloadSpeed = computed(() => downloads.value.reduce((sum, row) => sum + row.down, 0));
// Sticky for a few seconds, so a pause between two files does not flip the
// chip back to the count.
const downloading = ref(false);
let downloadingTimer: ReturnType<typeof setTimeout> | undefined;
watch(downloadSpeed, (speed) => {
  if (speed >= DOWNLOADING_MIN) {
    clearTimeout(downloadingTimer);
    downloadingTimer = undefined;
    downloading.value = true;
  } else if (downloading.value && !downloadingTimer) {
    downloadingTimer = setTimeout(() => {
      downloadingTimer = undefined;
      downloading.value = false;
    }, 4000);
  }
});
onUnmounted(() => clearTimeout(downloadingTimer));
const chipColor = computed(() => {
  const ms = gamePing.value;
  if (!ms) return "success";
  return ms <= 90 ? "success" : ms <= 200 ? "warning" : "error";
});

const inactiveTooltip = computed(() => {
  if (!titleIsOn.value) {
    return t("$vuetify.status.inactive");
  }
  if (!store.ndisRunning) {
    return t("$vuetify.status.serviceNotRunning");
  }
  return t("$vuetify.status.active");
});

const toggleDisabled = computed(() => !store.appReady);

async function onToggle() {
  await store.toggleTitleState(props.title);
}
</script>

<template>
  <span v-if="store.titleComingSoon(props.title.id)" class="tat">
    <ComingSoonMark />
  </span>
  <span v-else-if="titleUnavailable(props.title.id)" class="tat">
    <PlanLock unavailable />
  </span>
  <!-- The dot or chip turns into a switch while the row is hovered, in
       the same box: the row does not move. -->
  <v-tooltip
    v-else
    location="end"
    open-delay="200"
    max-width="280"
  >
    <template #activator="{ props: tip }">
      <span
        v-bind="tip"
        class="tat"
        :class="{ 'tat--disabled': toggleDisabled }"
        role="switch"
        :aria-checked="titleIsOn"
        @click.stop.prevent="!toggleDisabled && onToggle()"
      >
        <v-chip
          v-if="showConnectionChip || playingProfile"
          class="tat__face qa-title-conn-chip"
          :color="chipColor"
          size="x-small"
          variant="tonal"
          rounded="xl"
          tabindex="-1"
          :disabled="toggleDisabled"
        >
          <TitleGamePing
            v-if="playingProfile"
            :key="playingProfile"
            :profile-id="playingProfile"
            :fallback="localDigits(connectionCount)"
            @ping="gamePing = $event"
          />
          <span v-else-if="downloading" class="tat__speed">
            <v-icon icon="mdi-arrow-down" size="11" />{{ formatSpeedShort(downloadSpeed) }}
          </span>
          <template v-else>{{ localDigits(connectionCount) }}</template>
        </v-chip>
        <v-btn
          v-else
          class="tat__face tat__dot"
          :color="titleIsOn ? 'green' : 'secondary'"
          :icon="store.ndisRunning ? 'mdi-circle-medium' : 'mdi-circle-small'"
          variant="text"
          size="md"
          tabindex="-1"
          :disabled="toggleDisabled"
        />
        <v-switch
          class="tat__switch"
          inset
          density="compact"
          hide-details
          readonly
          color="green"
          tabindex="-1"
          :model-value="titleIsOn"
          :disabled="toggleDisabled"
        />
      </span>
    </template>

    <div v-if="showConnectionChip" class="qa-toggle-tip">
      <div
        v-if="titleIsOn"
        class="qa-toggle-tip__action"
      >
        {{ t("$vuetify.status.clickToDeactivate") }}
      </div>
      <div class="qa-toggle-tip__count">
        {{ t("$vuetify.connections.connectionsSubtitle", [localDigits(connectionCount)]) }}
      </div>
      <ul
        v-if="profileBreakdown.length"
        class="qa-toggle-tip__profiles"
      >
        <li
          v-for="row in profileBreakdown"
          :key="row.id"
          class="qa-toggle-tip__row"
        >
          <span class="qa-toggle-tip__name">{{ row.name }}</span>
          <span class="qa-toggle-tip__n">{{ localDigits(row.count) }}</span>
        </li>
      </ul>
      <ul
        v-if="downloads.length"
        class="qa-toggle-tip__profiles"
      >
        <li
          v-for="row in downloads"
          :key="row.id"
          class="qa-toggle-tip__speeds"
        >
          <div class="qa-toggle-tip__row">
            <span class="qa-toggle-tip__name">{{ row.name }}</span>
            <span class="qa-toggle-tip__n">
              <v-icon icon="mdi-arrow-down" size="11" />{{ formatSpeedShort(row.down) }}
              <v-icon icon="mdi-arrow-up" size="11" class="ms-1" />{{ formatSpeedShort(row.up) }}
            </span>
          </div>
          <div v-if="row.shares.length" class="qa-toggle-tip__balance">
            {{ t("$vuetify.status.loadBalanced") }}:
            <span v-for="(share, i) in row.shares" :key="share.name">
              {{ share.name }} {{ localDigits(share.share) }}%<template v-if="i < row.shares.length - 1"> · </template>
            </span>
          </div>
        </li>
      </ul>
    </div>
    <template v-else>{{ inactiveTooltip }}</template>
  </v-tooltip>
</template>

<style scoped>
/* The dot or chip, and the switch drawn small over it on row hover. */
.tat {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 24px;
  cursor: pointer;
}

.tat--disabled {
  cursor: default;
}

.tat__face,
.tat__switch {
  transition:
    transform 0.18s cubic-bezier(0.2, 0, 0, 1),
    opacity 0.18s ease;
}

.tat__face {
  pointer-events: none;
}

/* A little smaller than Vuetify's default dot. */
.tat__dot :deep(.v-icon) {
  font-size: 20px;
}

.tat__switch {
  position: absolute;
  top: 50%;
  left: 50%;
  width: max-content;
  flex: none;
  margin: 0;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -50%) scale(0);
}

.tat__switch :deep(.v-selection-control) {
  min-height: 0;
}

.v-list-item:hover .tat__face,
.v-list-item:focus-within .tat__face {
  opacity: 0;
  transform: scale(0);
}

.v-list-item:hover .tat__switch,
.v-list-item:focus-within .tat__switch {
  opacity: 1;
  transform: translate(-50%, -50%) scale(0.6);
}

.qa-title-conn-chip {
  cursor: pointer;
  min-width: 1.25rem;
  justify-content: center;
  font-variant-numeric: tabular-nums;
}
</style>

<style>
.qa-toggle-tip {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 10.5rem;
  padding: 0.15rem 0.05rem;
  line-height: 1.35;
}

.qa-toggle-tip__action {
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: rgba(255, 255, 255, 0.92);
}

.qa-toggle-tip__count {
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.62);
}

.qa-toggle-tip__profiles {
  margin: 0.15rem 0 0;
  padding: 0.4rem 0 0;
  list-style: none;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
  display: flex;
  flex-direction: column;
  gap: 0.28rem;
}

.qa-toggle-tip__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.85rem;
  font-size: 0.72rem;
}

.qa-toggle-tip__name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgba(255, 255, 255, 0.86);
}

.qa-toggle-tip__n {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

/* A downloading profile: its speeds, then how load balancing splits it. */
.qa-toggle-tip__speeds {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.qa-toggle-tip__balance {
  font-size: 0.68rem;
  color: rgba(255, 255, 255, 0.62);
}

/* The chip's download speed. */
.tat__speed {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
