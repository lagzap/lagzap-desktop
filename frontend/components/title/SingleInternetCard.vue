<script setup lang="ts">
import { useLocale } from "vuetify";
import AdapterPing from "~/components/network/AdapterPing.vue";
import InternetCard from "~/components/title/InternetCard.vue";
import InternetRow from "~/components/title/InternetRow.vue";
import { adapterIcon } from "~/utils/adapterIcon";
import { useStore } from "@/stores";

// A profile's one internet (default_interface), as a card (InternetCard):
// the Default internet — what the settings or Windows use, the card dashed —
// or one picked, all its traffic through that one. One picked but not
// connected now, or without internet, is in the warning color.
const props = defineProps<{
  /** The internet picked, "" for the Default internet. */
  selected: string;
  /** The internets connected now. */
  adapters: string[];
  missing: string[];
  down?: string[];
  loading: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  change: [name: string];
  refresh: [];
}>();
const { t } = useLocale();
const store = useStore();
const s = (key: string, ...params: unknown[]) => t(`$vuetify.title.profile.server.${key}`, ...params);

/** The connected internets, then the picked one if it is not connected. */
const rows = computed(() =>
  props.selected && !props.adapters.includes(props.selected) ? [...props.adapters, props.selected] : props.adapters,
);
const isMissing = (name: string) => props.missing.includes(name) || !props.adapters.includes(name);
const isDown = (name: string) => !isMissing(name) && !!props.down?.includes(name);
const broken = (name: string) => isMissing(name) || isDown(name);
</script>

<template>
  <InternetCard
    settings-link
    :on="!!selected"
    :title="s('internetTitle')"
    :icon="selected ? adapterIcon(selected) : 'mdi-lan'"
    no-toggle
    :disabled="disabled"
    refresh
    :loading="loading"
    @refresh="emit('refresh')"
  >
    <template #state>
      <span
        v-if="selected && isDown(selected)"
        class="text-warning">
        {{ s("allTrafficViaDown", selected) }}
      </span>
      <span
        v-else-if="selected && isMissing(selected)"
        class="text-warning">
        {{ t("$vuetify.title.profile.ifaceMissing", selected) }}
      </span>
      <span
        v-else-if="selected"
        class="text-primary">
        {{ s("allTrafficVia", selected) }}
      </span>
      <span
        v-else-if="store.defaultInterface"
        class="text-medium-emphasis">
        {{ s("allTrafficDefault", store.defaultInterface) }}
      </span>
      <span
        v-else
        class="text-medium-emphasis">{{ s("loadBalanceDefaultInternet") }}</span>
    </template>

    <InternetRow
      :name="s('loadBalanceDefaultInternet')"
      icon="mdi-auto-fix"
      radio
      :picked="!selected"
      :disabled="disabled"
      @pick="emit('change', '')"
    >
      <template #append>
        <span
          v-if="store.defaultInterface"
          class="text-caption text-medium-emphasis">{{ store.defaultInterface }}</span>
      </template>
    </InternetRow>
    <InternetRow
      v-for="name in rows"
      :key="name"
      :name="name"
      :icon="adapterIcon(name)"
      radio
      :picked="selected === name"
      :missing="broken(name)"
      :missing-text="isDown(name) ? s('noInternetShort') : undefined"
      :disabled="disabled"
      @pick="emit('change', isMissing(name) && selected === name ? '' : name)"
    >
      <template
        v-if="!broken(name)"
        #append>
        <AdapterPing :name="name" />
      </template>
    </InternetRow>
  </InternetCard>
</template>
