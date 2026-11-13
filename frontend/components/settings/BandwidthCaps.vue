<script setup lang="ts">
import { useLocale } from "vuetify";
import AppLimitDialog from "~/components/network/bandwidth/AppLimitDialog.vue";
import { untilText } from "~/components/network/bandwidth/until";
import { deleteLimit, highTrafficLimit, limitActiveNow, nowMs, saveLimit } from "~/composables/useBandwidthControl";
import { formatSpeed } from "~/utils/localeFormat";

/** The cap every high-traffic profile LagZap routes (launchers, downloads)
 * gets unless it sets its own. Kept on this PC (IndexedDB) like the other
 * Bandwidth Control caps. */
const { t } = useLocale();
const bc = (key: string, ...params: unknown[]) => t(`$vuetify.bandwidthControl.${key}`, ...params);

const dialog = ref(false);

const label = computed(() => {
  const limit = highTrafficLimit.value;
  if (!limit) return bc("highTrafficOff");
  if (!limit.enabled) return bc("capOff");
  const speed = formatSpeed(limit.download);
  let text = limit.only_while_gaming ? bc("capWaiting", speed) : bc("capped", speed);
  if (limit.until_restart) text += ` · ${bc("untilRestartShort")}`;
  else if (limit.expires_at) text += ` · ${bc("endsIn", untilText(limit.expires_at, t, nowMs.value))}`;
  return text;
});

function toggle(enabled: boolean | null) {
  const limit = highTrafficLimit.value;
  if (limit) saveLimit({ ...limit, enabled: Boolean(enabled) });
}
</script>

<template>
  <v-card
    :title="t('$vuetify.navigation.bandwidthControl')"
    flat
    class="mt-3 bg-transparent"
    max-width="720"
  >
    <v-card-text>
      <div class="d-flex align-center ga-3">
        <v-icon
          icon="mdi-download-network-outline"
          class="flex-none" />
        <div class="flex-grow-1 min-w-0">
          <div class="text-body-2 font-weight-medium">
            {{ bc("highTrafficSetting") }}
          </div>
          <div class="text-caption text-medium-emphasis">
            {{ bc("highTrafficSettingHint") }}
          </div>
        </div>
        <v-chip
          :color="highTrafficLimit && limitActiveNow(highTrafficLimit) ? 'warning' : undefined"
          size="small"
          variant="tonal"
          prepend-icon="mdi-speedometer-slow"
        >
          {{ label }}
        </v-chip>
        <v-switch
          v-if="highTrafficLimit"
          :model-value="highTrafficLimit.enabled"
          color="primary"
          density="compact"
          hide-details
          inset
          class="flex-none"
          @update:model-value="toggle"
        />
        <v-btn
          :icon="highTrafficLimit ? 'mdi-pencil-outline' : 'mdi-plus'"
          size="small"
          variant="text"
          :aria-label="highTrafficLimit ? bc('editCap') : bc('addCap')"
          @click="dialog = true"
        />
      </div>
    </v-card-text>

    <AppLimitDialog
      v-model="dialog"
      path=""
      :name="bc('highTraffic')"
      :limit="highTrafficLimit"
      fixed="high_traffic"
      @save="saveLimit"
      @remove="deleteLimit"
    />
  </v-card>
</template>

<style scoped>
.flex-none {
  flex: none;
}

.min-w-0 {
  min-width: 0;
}
</style>
