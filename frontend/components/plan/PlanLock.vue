<script setup lang="ts">
import { useLocale } from "vuetify";
import { usePlanAccess } from "~/composables/usePlanAccess";

/** Stands in for a toggle the user's plan does not allow: a gray lock that
 * turns amber on hover and opens the plans page. `chip` shows it with the
 * purchase label instead. `unavailable`: no plan offers it yet, so the lock
 * stays gray and only says so. */
const props = withDefaults(
  defineProps<{
    chip?: boolean;
    size?: number | string;
    unavailable?: boolean;
    /** The plan limit that would unlock it, so Plans picks that plan. */
    need?: { option: string; value: number };
  }>(),
  { chip: false, size: 14, unavailable: false, need: undefined },
);

const { t } = useLocale();
const { canUpgrade, openUpgrade } = usePlanAccess();
const purchase = () => openUpgrade(props.need);
</script>

<template>
  <v-tooltip
    :text="props.unavailable ? t('$vuetify.plan.unavailableTip') : t('$vuetify.plan.lockedTip')"
    location="top"
    open-delay="200"
  >
    <template #activator="{ props: tip }">
      <v-chip
        v-if="props.chip"
        v-bind="tip"
        size="small"
        variant="tonal"
        color="amber"
        prepend-icon="mdi-lock"
        :disabled="!canUpgrade"
        @click.stop.prevent="purchase"
      >
        {{ t("$vuetify.plan.unlock") }}
      </v-chip>
      <span v-else-if="props.unavailable" v-bind="tip" class="plan-lock plan-lock--unavailable">
        <v-icon icon="mdi-lock" :size="props.size" />
      </span>
      <v-btn
        v-else
        v-bind="tip"
        icon
        variant="text"
        size="x-small"
        class="plan-lock"
        :aria-label="t('$vuetify.plan.unlock')"
        @click.stop.prevent="purchase"
      >
        <v-icon icon="mdi-lock" :size="props.size" />
      </v-btn>
    </template>
  </v-tooltip>
</template>

<style scoped>
.plan-lock {
  color: rgba(var(--v-theme-on-surface), 0.38);
  transition: color 0.15s ease;
}

.plan-lock:not(.plan-lock--unavailable):hover,
.plan-lock:not(.plan-lock--unavailable):focus-visible {
  color: #ffc107;
}

.plan-lock--unavailable {
  display: inline-flex;
  padding: 6px;
  cursor: default;
}
</style>
