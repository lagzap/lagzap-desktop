<script setup lang="ts">
import { useFavoriteTitles } from "~/composables/useFavoriteTitles";
import { useLocale } from "vuetify";

const props = withDefaults(
  defineProps<{
    titleId: string;
    size?: "x-small" | "small" | "default";
  }>(),
  {
    size: "small",
  }
);

const { t } = useLocale();
const { isFavorite, toggleFavorite, canPinMore } = useFavoriteTitles();

const favorited = computed(() => isFavorite(props.titleId));

const tooltip = computed(() => {
  if (favorited.value) {
    return t("$vuetify.title.unpinFavorite");
  }
  if (!canPinMore.value) {
    return t("$vuetify.title.favoriteLimit");
  }
  return t("$vuetify.title.pinFavorite");
});

const disabled = computed(
  () => !favorited.value && !canPinMore.value
);

async function onClick(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  await toggleFavorite(props.titleId);
}
</script>

<template>
  <v-tooltip :text="tooltip">
    <template #activator="{ props: tipProps }">
      <v-btn
        v-bind="tipProps"
        :icon="favorited ? 'mdi-star' : 'mdi-star-outline'"
        :color="favorited ? 'amber' : 'secondary'"
        variant="text"
        :size="size"
        :disabled="disabled"
        @click="onClick"
      />
    </template>
  </v-tooltip>
</template>
