<script setup lang="ts">
import { computed } from "vue";
import { useLocale } from "vuetify";
import { useRouteLevel } from "~/composables/useRouteLevel";
import { usePlanAccess } from "~/composables/usePlanAccess";

/** The route level as small colored text (Basic orange, Advanced blue,
 * Ultimate lime). Its tooltip says what the level does and what the next
 * one adds; below Ultimate, clicking opens the plans page. */
const props = defineProps<{ level: number }>();

const LEVEL_COLOR: Record<number, string> = { 1: "#ff9800", 2: "#2196f3", 3: "#cddc39" };

const { t } = useLocale();
const { levelName, levelHint } = useRouteLevel();
const plan = usePlanAccess();

const next = computed(() => (props.level >= 1 && props.level < 3 && !plan.admin.value ? props.level + 1 : 0));
const upgradable = computed(() => next.value > 0 && plan.canUpgrade.value);

function onClick() {
  if (upgradable.value) plan.openUpgrade();
}
</script>

<template>
  <v-tooltip v-if="levelName(level)" location="bottom" max-width="300" open-delay="150">
    <template #activator="{ props: tip }">
      <span
        v-bind="tip"
        class="route-level-text"
        :class="{ 'route-level-text--upgradable': upgradable }"
        :style="{ color: LEVEL_COLOR[level] }"
        @click.stop="onClick"
      >
        {{ t("$vuetify.routeLevel.routes", levelName(level)) }}
      </span>
    </template>
    <div class="font-weight-medium">{{ t("$vuetify.routeLevel.using", levelName(level)) }}</div>
    <div class="text-caption">{{ levelHint(level) }}</div>
    <template v-if="next">
      <div class="font-weight-medium mt-2" :style="{ color: LEVEL_COLOR[next] }">
        {{ t("$vuetify.routeLevel.upgradeTo", levelName(next)) }}
      </div>
      <div class="text-caption">{{ levelHint(next) }}</div>
      <div v-if="upgradable" class="text-caption mt-1 text-medium-emphasis">
        {{ t("$vuetify.routeLevel.clickForPlans") }}
      </div>
    </template>
  </v-tooltip>
</template>

<style scoped>
.route-level-text {
  font-size: 0.75rem;
  font-weight: 500;
  white-space: nowrap;
  border-bottom: 1px dotted currentColor;
  cursor: help;
}

.route-level-text--upgradable {
  cursor: pointer;
}
</style>
