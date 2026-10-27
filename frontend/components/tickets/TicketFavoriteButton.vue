<script setup lang="ts">
import { useTicketQuickAccess } from "~/composables/useTicketQuickAccess";
import { useLocale } from "vuetify";

const props = withDefaults(
  defineProps<{
    ticketId: string;
    size?: "x-small" | "small" | "default";
  }>(),
  {
    size: "small",
  },
);

const { t } = useLocale();
const { isFavorite, toggleFavorite, canPinMore } = useTicketQuickAccess();

const favorited = computed(() => isFavorite(props.ticketId));

const tooltip = computed(() => {
  if (favorited.value) {
    return t("$vuetify.tickets.unpinFavorite");
  }
  if (!canPinMore.value) {
    return t("$vuetify.tickets.favoriteLimit");
  }
  return t("$vuetify.tickets.pinFavorite");
});

const disabled = computed(() => !favorited.value && !canPinMore.value);

async function onClick(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  await toggleFavorite(props.ticketId);
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
