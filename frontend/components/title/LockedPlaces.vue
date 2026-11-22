<script setup lang="ts">
import { useLocale } from "vuetify";
import CountryFlag from "vue-country-flag-next";
import { usePlanAccess } from "~/composables/usePlanAccess";

/** Places the plan locks, at the end of a location list: shown with a
 * purchase icon, and picking one opens the plans. */
export type LockedPlace = { key: string; label: string; country: string };

defineProps<{ places: LockedPlace[] }>();
const emit = defineEmits<{ upgrade: [] }>();

const { t } = useLocale();
const plan = usePlanAccess();

function upgrade() {
  emit("upgrade");
  plan.openUpgrade();
}
</script>

<template>
  <template v-if="places.length">
    <v-list-subheader class="mt-2">{{ t("$vuetify.plan.moreAccess") }}</v-list-subheader>
    <v-tooltip
      v-for="place in places"
      :key="place.key"
      :text="t('$vuetify.plan.lockedTip')"
      location="top"
      max-width="260"
      open-delay="300"
    >
      <template #activator="{ props: tip }">
        <v-list-item v-bind="tip" density="compact" class="ms-3 locked-place" @click="upgrade">
          <template #title>
            <div class="d-flex align-center">
              <v-avatar size="24" rounded="0">
                <span style="height: 40px">
                  <CountryFlag :country="place.country" />
                </span>
              </v-avatar>
              <div class="ms-2 text-caption">{{ place.label }}</div>
            </div>
          </template>
          <template #append>
            <v-icon icon="mdi-cart-outline" size="18" color="amber" :aria-label="t('$vuetify.plan.unlock')" />
          </template>
        </v-list-item>
      </template>
    </v-tooltip>
  </template>
</template>

<style scoped>
.locked-place :deep(.v-list-item-title) {
  opacity: 0.7;
}
</style>
