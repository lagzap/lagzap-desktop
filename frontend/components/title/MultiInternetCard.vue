<script setup lang="ts">
import { useLocale } from "vuetify";
import AdapterPing from "~/components/network/AdapterPing.vue";
import InternetCard from "~/components/title/InternetCard.vue";
import InternetRow from "~/components/title/InternetRow.vue";
import { adapterIcon } from "~/utils/adapterIcon";
import { useNetworkAdapterSettings } from "~/composables/useNetworkAdapterSettings";
import { useStore } from "@/stores";
import { localDigits } from "~/utils/localeFormat";

// A profile's Multi Internet in Route Settings, as a card (InternetCard).
// Its checkbox has three states, each click the next:
//   - indeterminate: not set here (network_interfaces empty), it follows the
//     Multi Internet settings — dashed, in the default color;
//   - ticked: on for this app, the internets ticked under it (two or more);
//   - unticked: off for this app — the one internet ticked under it, or with
//     none ticked ("-") the Default internet (the profile's, else Windows'
//     own, falling back when it is down).
// Set here, every internet is listed with its ping; unticking the last one
// leaves the Default internet. One picked but not connected now is in the
// warning color, with Remove.
const props = defineProps<{
  /** The profile's picked internets (network_interfaces). */
  selected: string[];
  /** The internets connected now. */
  adapters: string[];
  /** Picked but not connected now. */
  missing: string[];
  /** Connected but with no internet now (LagZap uses another meanwhile). */
  down?: string[];
  loading: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  change: [names: string[]];
  remove: [name: string];
  refresh: [];
}>();
const { t, current } = useLocale();
const store = useStore();
const { multiInternet } = useNetworkAdapterSettings();

/** Multi Internet off for this app on the Default internet. */
const OFF_DEFAULT = "-";
/** Set on this profile (not following the settings). */
const on = computed(() => props.selected.length > 0);
/** The internets ticked ("-" is no internet: the Default one). */
const picks = computed(() => props.selected.filter((name) => name && name !== OFF_DEFAULT && name !== "*"));
const offDefault = computed(() => on.value && picks.value.length === 0);
/** Not set here, but the Multi Internet settings join several internets:
 * those are used. Following the settings is in the default color, dashed;
 * only on or off set for this app is in the primary color. */
const fromSettings = computed(() => multiInternet.selection.value.filter((name) => props.adapters.includes(name)));
const inherited = computed(() => !on.value && fromSettings.value.length > 1);
const enabled = computed(() => (on.value ? picks.value.length > 1 : inherited.value));
const list = (names: string[]) => new Intl.ListFormat(current.value, { type: "conjunction" }).format(names);
/** The connected internets, then picked ones that are not connected. */
const rows = computed(() => [
  ...props.adapters,
  ...picks.value.filter((name) => !props.adapters.includes(name)),
]);
const isMissing = (name: string) => props.missing.includes(name) || !props.adapters.includes(name);
const isDown = (name: string) => !isMissing(name) && !!props.down?.includes(name);

/** Following → on for this app (every connected internet) → off for this
 * app on the Default internet → following. With one internet only, on is
 * skipped. */
function toggle() {
  if (!on.value) {
    emit("change", props.adapters.length > 1 ? [...props.adapters] : [OFF_DEFAULT]);
    return;
  }
  if (picks.value.length > 1) {
    emit("change", [OFF_DEFAULT]);
    return;
  }
  emit("change", []);
}
/** Ticking adds an internet; unticking the last leaves the Default one. */
function pick(name: string) {
  const next = picks.value.includes(name) ? picks.value.filter((n) => n !== name) : [...picks.value, name];
  emit("change", next.length > 0 ? next : [OFF_DEFAULT]);
}
</script>

<template>
  <InternetCard
    settings-link
    :on="on"
    :title="t('$vuetify.title.profile.multiInternet')"
    icon="mdi-lan"
    :disabled="disabled"
    :checked="on && picks.length > 1"
    :indeterminate="!on"
    :refresh="on"
    :loading="loading"
    @toggle="toggle"
    @refresh="emit('refresh')"
  >
    <!-- Multi Internet on or off for this profile, said by the name. -->
    <template #title-append>
      <v-chip
        size="x-small"
        variant="tonal"
        :color="on && enabled ? 'primary' : undefined"
      >
        {{ t(enabled ? "$vuetify.title.profile.multiInternetEnabled" : "$vuetify.title.profile.multiInternetDisabled") }}
      </v-chip>
    </template>
    <template #state>
      <span
        v-if="offDefault"
        class="text-primary">
        {{ store.defaultInterface
          ? t("$vuetify.title.profile.multiInternetOffDefault", store.defaultInterface)
          : t("$vuetify.title.profile.multiInternetOffDefaultBare") }}
      </span>
      <span
        v-else-if="on && !enabled"
        class="text-primary">
        {{ t("$vuetify.title.profile.multiInternetOffHere", picks[0]) }}
      </span>
      <span
        v-else-if="on"
        class="text-primary d-flex align-center">
        <v-icon
          size="14"
          class="me-1">
          mdi-check
        </v-icon>
        {{ t("$vuetify.title.profile.server.multiInternetCount", localDigits(picks.length)) }}
      </span>
      <span
        v-else-if="inherited"
        class="text-medium-emphasis">
        {{ t("$vuetify.title.profile.multiInternetFromSettings", list(fromSettings)) }}
      </span>
      <span
        v-else-if="store.defaultInterface"
        class="text-medium-emphasis">
        {{ t("$vuetify.title.profile.multiInternetUsesOne", store.defaultInterface) }}
      </span>
      <span
        v-else
        class="text-medium-emphasis">
        {{ t("$vuetify.title.profile.server.automaticSelection") }}
      </span>
    </template>
    <template
      v-if="on"
      #default>
      <InternetRow
        v-for="name in rows"
        :key="name"
        :name="name"
        :icon="adapterIcon(name)"
        :picked="picks.includes(name)"
        :missing="isMissing(name) || isDown(name)"
        :missing-text="isDown(name) ? t('$vuetify.title.profile.server.noInternetShort') : undefined"
        :disabled="disabled"
        @pick="isMissing(name) ? emit('remove', name) : pick(name)"
      >
        <template #append>
          <v-btn
            v-if="isMissing(name)"
            size="x-small"
            variant="tonal"
            color="warning"
            class="text-none"
            :disabled="disabled"
            @click.stop="emit('remove', name)"
          >
            {{ t("$vuetify.title.profile.server.removeInternet") }}
          </v-btn>
          <AdapterPing
            v-else-if="!isDown(name)"
            :name="name" />
        </template>
      </InternetRow>
    </template>
  </InternetCard>
</template>
