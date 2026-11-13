<script setup lang="ts">
import { useLocale } from "vuetify";
import AppLimitDialog from "~/components/network/bandwidth/AppLimitDialog.vue";
import { untilText } from "~/components/network/bandwidth/until";
import { adapterLimit, deleteLimit, limitActiveNow, nowMs, saveLimit } from "~/composables/useBandwidthControl";
import { formatSpeed } from "~/utils/localeFormat";

/** One internet's speed cap (Bandwidth Control, kept on this PC). Click to
 * set or change it, clear to remove it. */
const props = defineProps<{ name: string }>();

const { t } = useLocale();
const bc = (key: string, ...params: unknown[]) => t(`$vuetify.bandwidthControl.${key}`, ...params);

const limit = computed(() => adapterLimit(props.name));
const dialog = ref(false);

const text = computed(() => {
  const cap = limit.value;
  if (!cap) return "";
  if (!cap.enabled) return bc("capOff");
  const speed = formatSpeed(cap.download);
  let label = cap.only_while_gaming ? bc("capWaiting", speed) : speed;
  if (cap.until_restart) label += ` · ${bc("untilRestartShort")}`;
  else if (cap.expires_at) label += ` · ${bc("endsIn", untilText(cap.expires_at, t, nowMs.value))}`;
  return label;
});
</script>

<template>
  <div>
    <v-text-field
      :model-value="text"
      :label="t('$vuetify.settings.multiInternetPage.speedCap')"
      :placeholder="t('$vuetify.settings.multiInternetPage.speedCapNone')"
      persistent-placeholder
      prepend-inner-icon="mdi-speedometer-slow"
      :base-color="limit && limitActiveNow(limit) ? 'warning' : undefined"
      variant="outlined"
      density="compact"
      hide-details
      readonly
      :clearable="!!limit"
      class="adapter-speed-cap"
      @click="dialog = true"
      @click:clear.stop="limit && deleteLimit(limit.id)"
    />
    <AppLimitDialog
      v-model="dialog"
      :path="name"
      :name="name"
      :limit="limit"
      fixed="adapter"
      @save="saveLimit"
      @remove="deleteLimit"
    />
  </div>
</template>

<style scoped>
.adapter-speed-cap :deep(input) {
  cursor: pointer;
}
</style>
