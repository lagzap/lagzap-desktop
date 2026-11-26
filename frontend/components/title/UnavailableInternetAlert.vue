<script setup lang="ts">
import { useLocale } from "vuetify";
import type { Profile } from "~/bindings/github.com/lagzap/zap/data";
import { adapterIcon } from "~/utils/adapterIcon";

/** A game's profiles set to use an internet that is not connected now
 * (disabled or unplugged), or that has no internet (LagZap uses another
 * meanwhile): one alert per such internet, naming the profiles, with the
 * fixes — use a connected internet in its place, or remove it (LagZap then
 * picks). Shown with the game's other alerts. */
const props = defineProps<{ profiles: Profile[] }>();

const { t } = useLocale();
const store = useStore();
const p = (key: string, ...params: unknown[]) => t(`$vuetify.title.profile.${key}`, ...params);

/** Each internet not connected or without internet, and the profiles that
 * use it. */
const missing = computed(() => {
  const byName = new Map<string, { down: boolean; profiles: Profile[] }>();
  const add = (name: string, profile: Profile, down: boolean) => {
    const item = byName.get(name) ?? { down, profiles: [] };
    if (!item.profiles.includes(profile)) item.profiles.push(profile);
    byName.set(name, item);
  };
  for (const profile of props.profiles) {
    for (const name of store.getUnavailableInterfaces(profile.id)) add(name, profile, false);
    for (const name of store.getProfileInternetDown(profile.id)) add(name, profile, true);
  }
  return [...byName.entries()].map(([name, item]) => ({ name, ...item }));
});

/** Internets to switch to: connected, with internet. */
const connected = computed(() =>
  store.availableInterfaceNames.filter((name) => !store.internetDownNames.includes(name)),
);
const switchable = (name: string) => connected.value.filter((n) => n !== name);
const busy = ref("");

const profileNames = (profiles: Profile[]) => profiles.map((profile) => store.localized(profile.name)).join(", ");

async function switchTo(name: string, profiles: Profile[], replacement: string) {
  busy.value = name;
  try {
    for (const profile of profiles) await store.replaceUnavailableInterface(profile.id, name, replacement);
  } finally {
    busy.value = "";
  }
}

async function remove(name: string, profiles: Profile[]) {
  busy.value = name;
  try {
    for (const profile of profiles) await store.removeProfileInterface(profile.id, name);
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <template
    v-for="item in missing"
    :key="item.name">
    <v-alert
      type="warning"
      variant="tonal"
      density="compact"
      rounded="lg"
      icon="mdi-lan-disconnect"
    >
      <div class="d-flex align-center flex-wrap ga-2">
        <div class="flex-grow-1">
          <div class="font-weight-medium">
            {{ p(item.down ? "ifaceNoInternet" : "ifaceMissing", item.name) }}
          </div>
          <div class="text-body-2">
            {{ p(item.down ? "ifaceNoInternetHint" : "ifaceMissingHint", profileNames(item.profiles)) }}
          </div>
        </div>
        <v-btn
          variant="text"
          color="on-surface"
          size="small"
          class="text-none"
          :loading="busy === item.name"
          :disabled="!store.appReady"
          @click="remove(item.name, item.profiles)"
        >
          {{ p("ifaceRemove") }}
        </v-btn>
        <v-btn
          v-if="switchable(item.name).length === 1"
          variant="tonal"
          color="on-surface"
          size="small"
          class="text-none"
          :prepend-icon="adapterIcon(switchable(item.name)[0])"
          :disabled="!store.appReady || busy === item.name"
          @click="switchTo(item.name, item.profiles, switchable(item.name)[0])"
        >
          {{ p("ifaceSwitchTo", switchable(item.name)[0]) }}
        </v-btn>
        <v-menu
          v-else-if="switchable(item.name).length > 1"
          location="bottom end">
          <template #activator="{ props: menu }">
            <v-btn
              v-bind="menu"
              variant="tonal"
              color="on-surface"
              size="small"
              class="text-none"
              append-icon="mdi-chevron-down"
              :disabled="!store.appReady || busy === item.name"
            >
              {{ p("ifaceSwitch") }}
            </v-btn>
          </template>
          <v-list density="compact">
            <v-list-item
              v-for="name in switchable(item.name)"
              :key="name"
              :prepend-icon="adapterIcon(name)"
              :title="name"
              @click="switchTo(item.name, item.profiles, name)"
            />
          </v-list>
        </v-menu>
      </div>
    </v-alert>
  </template>
</template>
