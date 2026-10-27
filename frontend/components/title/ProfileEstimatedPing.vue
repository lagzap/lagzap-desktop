<script setup lang="ts">
import { useLocale, useTheme } from "vuetify";
import { ProbeProfileRoutes } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { getScoreAccent } from "~/composables/useLatencyMetrics";
import { useProfileEstimate } from "~/composables/useProfileChart";
import { BEST_INTERFACE, useProfileViewInterface } from "~/composables/useProfileViewInterface";

/** "Estimated Ping 101ms (21% loss)" in the profile card subtitle. Go picks
 * the ping and whether loss or lag is worth mentioning. Click measures now;
 * right-click holds the route view and Try fix lag. */
const props = defineProps<{
  profileId: string;
  /** "Show routes on" choices; empty when there is nothing to pick. */
  views?: { title: string; value: string }[];
  canFixLag?: boolean;
  fixingLag?: boolean;
}>();
const emit = defineEmits<{ fixLag: [] }>();
const { t } = useLocale();
const theme = useTheme();
const estimate = useProfileEstimate(props.profileId);
const { selectedInterfaceKey } = useProfileViewInterface(props.profileId);

const ping = computed(() => estimate.value?.ping ?? 0);
const note = computed(() => estimate.value?.note ?? "");
const color = computed(() =>
  ping.value > 0 ? getScoreAccent(estimate.value?.score ?? -1, theme.current.value.dark) ?? undefined : undefined
);
const noteText = computed(() =>
  note.value === "loss"
    ? t("$vuetify.title.profile.estimateLoss", localDigits(Math.round(estimate.value?.loss ?? 0)))
    : t("$vuetify.title.profile.estimateLag")
);

const probing = ref(false);
async function probe() {
  if (probing.value) return;
  probing.value = true;
  try {
    const iface = selectedInterfaceKey.value === BEST_INTERFACE ? "" : selectedInterfaceKey.value;
    await ProbeProfileRoutes(props.profileId, iface);
  } catch {
    // service not running
  } finally {
    probing.value = false;
  }
}

const menuOpen = ref(false);
const menuAt = ref<[number, number]>([0, 0]);
function openMenu(event: MouseEvent) {
  menuAt.value = [event.clientX, event.clientY];
  menuOpen.value = true;
}
const views = computed(() => props.views ?? []);
</script>

<template>
  <span v-if="estimate" class="est-ping" @contextmenu.prevent="openMenu">
    <span class="est-ping__label">{{ t("$vuetify.title.profile.estimatedPing") }}</span>
    <v-tooltip location="bottom" max-width="320" open-delay="150">
      <template #activator="{ props: tip }">
        <button
          v-bind="tip"
          type="button"
          class="est-ping__value"
          :style="{ color }"
          :disabled="probing"
          @click.stop="probe"
        >
          {{ probing ? t("$vuetify.title.profile.probingPing") : formatMs(ping) }}
        </button>
      </template>
      <div>{{ t("$vuetify.title.profile.estimatedPingTip") }}</div>
      <div class="est-ping__hint">{{ t("$vuetify.title.profile.estimatedPingActions") }}</div>
    </v-tooltip>
    <v-tooltip v-if="note" location="bottom" max-width="320" open-delay="150">
      <template #activator="{ props: tip }">
        <span
          v-bind="tip"
          class="est-ping__note"
          :class="note === 'loss' ? 'text-error' : 'text-warning'"
        >({{ noteText }})</span>
      </template>
      {{ note === "loss" ? t("$vuetify.title.profile.estimateLossTip") : t("$vuetify.title.profile.estimateLagTip") }}
    </v-tooltip>
    <span class="est-ping__sep">•</span>

    <v-menu v-model="menuOpen" :target="menuAt" location="bottom start" :close-on-content-click="true">
      <v-list density="compact" min-width="170" class="est-menu py-1">
        <v-list-item
          prepend-icon="mdi-radar"
          :title="t('$vuetify.title.profile.measurePingNow')"
          :disabled="probing"
          @click="probe"
        />
        <template v-if="views.length">
          <v-divider class="my-1" />
          <v-list-subheader>{{ t("$vuetify.title.profile.showRoutesOn") }}</v-list-subheader>
          <v-list-item
            v-for="view in views"
            :key="view.value"
            :title="view.title"
            :active="selectedInterfaceKey === view.value"
            color="primary"
            @click="selectedInterfaceKey = view.value"
          >
            <template #prepend>
              <v-icon :icon="selectedInterfaceKey === view.value ? 'mdi-radiobox-marked' : 'mdi-radiobox-blank'" />
            </template>
          </v-list-item>
        </template>
        <template v-if="canFixLag">
          <v-divider class="my-1" />
          <v-list-item
            prepend-icon="mdi-auto-fix"
            :title="t('$vuetify.networkLatency.tryFixLag')"
            :disabled="fixingLag"
            @click="emit('fixLag')"
          />
        </template>
      </v-list>
    </v-menu>
  </span>
</template>

<style scoped>
.est-ping {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.est-ping__label {
  color: rgb(var(--v-theme-on-surface));
}

.est-ping__value {
  font: inherit;
  font-weight: 600;
  color: inherit;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-decoration: underline dashed;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
}

.est-ping__value:disabled {
  cursor: progress;
  opacity: 0.7;
}

.est-ping__note {
  cursor: help;
}

.est-ping__hint {
  margin-top: 6px;
  opacity: 0.7;
}

/* Right-click menu: small rows, small text, small icons. */
.est-menu :deep(.v-list-item) {
  min-height: 30px;
  padding-inline: 10px;
}

.est-menu :deep(.v-list-item-title) {
  font-size: 0.8125rem;
}

.est-menu :deep(.v-list-item__prepend > .v-icon) {
  font-size: 16px;
}

.est-menu :deep(.v-list-item__spacer) {
  width: 10px !important;
}

.est-menu :deep(.v-list-subheader) {
  min-height: 26px;
  padding-inline: 10px !important;
  font-size: 0.6875rem;
}

.est-menu :deep(.v-divider) {
  margin-block: 2px !important;
}

.est-ping__sep {
  margin-inline: 4px;
  opacity: 0.5;
}
</style>
