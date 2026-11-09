<script setup lang="ts">
import { computed } from "vue";
import { useLocale } from "vuetify";
import { localDigits } from "~/utils/localeFormat";

/** The team's seats, owner included: used, held by pending invites, locked
 * after someone left or was removed, and free. */
const props = defineProps<{ seats: number; used: number; pending: number; locked: number; free: number }>();
const { t } = useLocale();

const parts = computed(() =>
  [
    { key: "used", n: props.used, color: "primary" },
    { key: "pending", n: props.pending, color: "info" },
    { key: "locked", n: props.locked, color: "warning" },
    { key: "free", n: props.free, color: "grey" },
  ].filter((p) => p.n > 0),
);
</script>

<template>
  <div class="seats">
    <div class="seats__bar">
      <template v-for="part in parts" :key="part.key">
        <span
          v-for="i in part.n"
          :key="`${part.key}-${i}`"
          class="seats__seat"
          :class="`seats__seat--${part.key} bg-${part.color}`"
        />
      </template>
    </div>
    <div class="d-flex flex-wrap ga-2 mt-2">
      <v-chip v-for="part in parts" :key="part.key" size="x-small" variant="tonal" :color="part.color">
        {{ t(`$vuetify.team.seats.${part.key}`, localDigits(part.n)) }}
      </v-chip>
    </div>
  </div>
</template>

<style scoped>
.seats__bar {
  display: flex;
  gap: 4px;
}

.seats__seat {
  flex: 1 1 0;
  height: 10px;
  border-radius: 5px;
}

.seats__seat--free {
  opacity: 0.25;
}

.seats__seat--pending,
.seats__seat--locked {
  opacity: 0.7;
}
</style>
