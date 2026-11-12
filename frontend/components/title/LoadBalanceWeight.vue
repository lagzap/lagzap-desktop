<script setup lang="ts">
import { useLocale } from "vuetify";
import type { LoadBalanceShare } from "~/bindings/github.com/lagzap/lagzap/adapter";
import { formatSpeed, localDigits } from "~/utils/localeFormat";

// One internet's share of a load-balancing profile's new connections. Click
// to set its weight (1..10), or Auto to follow its download speed.
const props = defineProps<{ share?: LoadBalanceShare }>();
const emit = defineEmits<{ set: [weight: number] }>();
const { t } = useLocale();

const open = ref(false);
const weight = ref(5);
watch(
  () => props.share?.weight,
  (value) => {
    if (value) weight.value = value;
  },
  { immediate: true },
);
const speedText = computed(() =>
  props.share?.speed_bytes ? formatSpeed(props.share.speed_bytes) : "—",
);
</script>

<template>
  <v-menu v-model="open" :close-on-content-click="false" location="bottom end">
    <template #activator="{ props: menu }">
      <v-chip
        v-bind="menu"
        size="x-small"
        variant="tonal"
        rounded="pill"
        class="me-3"
        :color="share?.manual ? 'primary' : undefined"
        :prepend-icon="share?.manual ? 'mdi-tune-variant' : 'mdi-auto-fix'"
        @click.stop
      >
        {{ share ? `${localDigits(share.percent)}%` : "…" }}
      </v-chip>
    </template>
    <v-card width="260" rounded="lg" @click.stop>
      <v-card-text class="pb-2">
        <div class="text-caption text-medium-emphasis mb-1">
          {{ t("$vuetify.title.profile.server.loadBalanceShareTitle") }}
        </div>
        <div class="text-body-2 font-weight-medium mb-2">
          {{ share ? `${localDigits(share.percent)}%` : "…" }}
          <span class="text-caption text-medium-emphasis ms-1">
            {{ share?.manual ? t("$vuetify.title.profile.server.loadBalanceWeight", localDigits(share.weight)) : t("$vuetify.title.profile.server.loadBalanceAuto") }}
          </span>
        </div>
        <v-slider
          v-model="weight"
          :min="1"
          :max="10"
          :step="1"
          show-ticks="always"
          tick-size="2"
          color="primary"
          density="compact"
          hide-details
          thumb-label
          @end="emit('set', weight)"
        />
      </v-card-text>
      <v-card-actions class="pt-0">
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-auto-fix"
          :color="share?.manual ? undefined : 'primary'"
          :title="t('$vuetify.title.profile.server.loadBalanceAutoHint')"
          @click="emit('set', 0); open = false"
        >
          {{ t("$vuetify.title.profile.server.loadBalanceAutoSpeed", speedText) }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-menu>
</template>
