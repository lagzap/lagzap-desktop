<script setup lang="ts">
import type { Title } from "~/bindings/github.com/lagzap/zap/data";
import { useLocale } from "vuetify";
import { useMonitoringStore } from "~/stores/monitoring";

const props = defineProps<{
  title: Title;
}>();

const store = useStore();
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

const inactiveTooltip = computed(() => {
  if (!titleIsOn.value) {
    return t("$vuetify.status.inactive");
  }
  if (!store.ndisRunning) {
    return t("$vuetify.status.serviceNotRunning");
  }
  return t("$vuetify.status.active");
});

async function onToggle() {
  await store.toggleTitleState(props.title);
}
</script>

<template>
  <v-tooltip
    v-if="showConnectionChip"
    location="end"
    open-delay="200"
    max-width="280"
  >
    <template #activator="{ props: tip }">
      <v-chip
        v-bind="tip"
        class="qa-title-conn-chip"
        color="success"
        size="x-small"
        variant="elevated"
        rounded="xl"
        label
        :disabled="!store.appReady"
        @click.stop.prevent="onToggle"
      >
        {{ localDigits(connectionCount) }}
      </v-chip>
    </template>

    <div class="qa-toggle-tip">
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
    </div>
  </v-tooltip>

  <v-tooltip
    v-else
    :text="inactiveTooltip"
  >
    <template #activator="{ props: tip }">
      <v-btn
        v-bind="tip"
        :color="titleIsOn ? 'green' : 'secondary'"
        :icon="store.ndisRunning ? 'mdi-circle-medium' : 'mdi-circle-small'"
        variant="text"
        size="md"
        :disabled="!store.appReady"
        @click.stop.prevent="onToggle"
      />
    </template>
  </v-tooltip>
</template>

<style scoped>
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
</style>
