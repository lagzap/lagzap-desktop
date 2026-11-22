<script setup lang="ts">
import FlagImg from "~/components/common/FlagImg.vue";
import ProfileRegionSelection from "~/components/title/ProfileRegionSelection.vue";
import { useTitleMenu } from "~/composables/useTitleMenu";
import { useLocalStorage } from "@vueuse/core";
import { useLocale } from "vuetify";
import type { Node, Profile, RelayRoute } from "~/bindings/github.com/lagzap/zap/data";
import { RoutingMode } from "~/bindings/github.com/lagzap/zap/data";
import { ProfileFlag } from "~/constants/profile";
import { useRegionSelection } from "~/composables/useRegionSelection";
import Ping from "~/components/network/Ping.vue";
import { useRouteLine } from "~/composables/useRouteLine";
import { useStore } from "@/stores";
import { displayPingMsForRelay } from "~/composables/relayPingDisplay";
import { usePlanAccess } from "~/composables/usePlanAccess";
import { countryName } from "~/utils/localeFormat";

/* Where the game plays from, by what the player wants:
 *  - Lower my ping: the game's servers (the game-packet profile, else the
 *    first by order), by city, fastest first. Fastest lets it pick and
 *    switch by itself.
 *  - Change my region: the first other profile by order (login), by
 *    country: where the game sees the player. Automatic picks for it.
 * One switch picks the side; a title with only one kind shows only it.
 * More options opens that side's full selector. */
const props = defineProps<{
  profiles: Profile[];
}>();

const { t } = useLocale();
const store = useStore();
const plan = usePlanAccess();

type Pick = { profile: Profile; sel: ReturnType<typeof useRegionSelection> };
const picks: Pick[] = props.profiles.map((profile) => ({ profile, sel: useRegionSelection(profile) }));
const isGame = (p: Pick) => (p.profile.flags & ProfileFlag.GAME_PACKET) !== 0;
const byOrder = [...picks].sort((a, b) => (a.profile.order ?? 0) - (b.profile.order ?? 0));
/** Ping: the game-packet profile; without one, the first by order. That
 * one profile is what the picker shows and changes. */
const pingPicks = byOrder.some(isGame) ? byOrder.filter(isGame).slice(0, 1) : byOrder.slice(0, 1);
/** Region: the first other profile by order (only next to a game's). */
const regionPicks = byOrder.some(isGame) ? byOrder.filter((p) => !isGame(p)).slice(0, 1) : [];
const pingMain = pingPicks[0];
const regionMain = regionPicks[0] ?? null;
const titleId = byOrder[0].profile.title_id;
/** A game: its servers' ping is the point. Other titles (apps, voice) just
 * pick where they connect from, with no ping-or-region question. */
const isGameTitle = picks.some(isGame);

type Intent = "ping" | "region";
const intent = useLocalStorage<Intent>(`lz-play-from-intent-${titleId}`, "ping");
const hasBoth = regionPicks.length > 0;
const intents = computed(() => [
  { value: "ping" as Intent, icon: "mdi-lightning-bolt", title: t("$vuetify.title.playFrom.lowerPing") },
  { value: "region" as Intent, icon: "mdi-earth", title: t("$vuetify.title.playFrom.changeRegion") },
]);
const side = computed<Intent>(() => (hasBoth ? intent.value : "ping"));
const sidePicks = computed(() => (side.value === "ping" ? pingPicks : regionPicks));
const sideMain = computed(() => (side.value === "ping" ? pingMain : regionMain ?? pingMain));

const GLOBAL = RoutingMode.RoutingMode_ROUTING_MODE_GLOBAL;
const COUNTRY = RoutingMode.RoutingMode_ROUTING_MODE_COUNTRY;
const CITY = RoutingMode.RoutingMode_ROUTING_MODE_CITY;

/** A side's choice: "auto", "city:x", "country:xx", or "set" (picked in the
 * full selector: several places, a region, a server). */
type Choice = "auto" | `city:${string}` | `country:${string}` | "set";
function choiceOf(profileId: string): Choice | null {
  const st = store.profileStates[profileId];
  if (!st) return null;
  const mode = st.mode ?? GLOBAL;
  if (mode === GLOBAL) return "auto";
  if (mode === CITY && st.cities?.length === 1 && !st.node_id) return `city:${st.cities[0]}`;
  if (mode === COUNTRY && st.countries?.length === 1 && !st.node_id) return `country:${st.countries[0]}`;
  return "set";
}
function groupChoice(group: Pick[]): Choice {
  const own = group.map((p) => choiceOf(p.profile.id)).filter((c): c is Choice => c !== null);
  if (!own.length) return "auto";
  const first = own.find((c) => c !== "auto") ?? "auto";
  return own.every((c) => c === first || c === "auto") ? first : "set";
}
const current = computed(() => groupChoice(sidePicks.value));

/** The ping a list shows for a place (the same as its Ping), to sort by. */
const { routeProbeHistory } = useMonitoringStore();
function bestMs(route: RelayRoute | null): number {
  const ms = route ? displayPingMsForRelay(route.tag, route, routeProbeHistory.value) : null;
  return ms != null && ms > 0 ? ms : Infinity;
}
/** Ping side: cities with a working route, fastest first; the ones the
 * plan locks last (picking one offers the plans). */
const cities = computed(() => {
  const sel = pingMain.sel;
  const open = Object.keys(sel.cityMap.value)
    .map((key) => {
      const nodes = sel.cityMap.value[key] ?? [];
      const route = sel.lowestPingForCity(key);
      return { key, label: sel.getCityLabel(key), country: nodes[0]?.country ?? "", tag: route?.tag ?? "", ms: bestMs(route), locked: false };
    })
    .filter((c) => c.tag && Number.isFinite(c.ms))
    .sort((a, b) => a.ms - b.ms);
  const locked = Object.entries(sel.lockedCityMap.value).map(([key, nodes]) => ({
    key, label: sel.getCityLabel(key), country: nodes[0]?.country ?? "", tag: "", ms: Infinity, locked: true,
  }));
  return [...open, ...locked.sort((a, b) => a.label.localeCompare(b.label))];
});

/** Region side: countries with a working route, nearest first. */
const countries = computed(() => {
  if (!regionMain) return [];
  const sel = regionMain.sel;
  const all = Object.entries(sel.areas.value ?? {}).map(([code, list]) => {
    const nodes = (list as Node[]).filter(Boolean);
    const route = sel.getLowestPingForCountry(nodes);
    return { key: code, label: countryName(code) || code, country: code, tag: route?.tag ?? "", ms: bestMs(route), locked: false };
  });
  const open = all.filter((c) => c.tag && Number.isFinite(c.ms)).sort((a, b) => a.ms - b.ms);
  const locked = Object.keys(sel.lockedAreas.value).map((code) => ({
    key: code, label: countryName(code) || code, country: code, tag: "", ms: Infinity, locked: true,
  }));
  return [...open, ...locked.sort((a, b) => a.label.localeCompare(b.label))];
});

type Place = { key: string; label: string; country: string; tag: string; ms: number; locked: boolean };
/** Fastest first: for the chips and the "Best ping" mark. */
const places = computed<Place[]>(() => (side.value === "ping" ? cities.value : countries.value));
/** The menu's list: by country, then city, A to Z; locked ones last. */
const abc = (a: Place, b: Place) =>
  (countryName(a.country) || a.country).localeCompare(countryName(b.country) || b.country) ||
  a.label.localeCompare(b.label);
const listed = computed<Place[]>(() => [
  ...places.value.filter((c) => !c.locked).sort(abc),
  ...places.value.filter((c) => c.locked).sort(abc),
]);
const prefix = computed(() => (side.value === "ping" ? "city:" : "country:"));
const bestPlace = computed(() => places.value.find((c) => !c.locked)?.key ?? "");
const currentPlace = computed(() => {
  if (current.value.startsWith(prefix.value)) {
    return places.value.find((c) => c.key === current.value.slice(prefix.value.length)) ?? null;
  }
  // The region side set to one city (from before, or More options): that
  // city, with its country's flag.
  if (side.value === "region" && regionMain && current.value.startsWith("city:")) {
    const key = current.value.slice(5);
    const nodes = regionMain.sel.cityMap.value[key] ?? [];
    return { key, label: regionMain.sel.getCityLabel(key), country: nodes[0]?.country ?? "", tag: "", ms: Infinity, locked: false };
  }
  return null;
});
/** Fastest: the city the game's traffic leaves from right now, when live. */
const { exitCity } = useRouteLine(pingMain.profile.id);
const nowOn = computed(() => (side.value === "ping" && current.value === "auto" ? exitCity.value : ""));

const open = ref(false);
const fullOpen = ref(false);
// A title's right-click menu asked for its location: open the picker.
const titleMenu = useTitleMenu();
onMounted(() => {
  if (titleMenu.take(titleId, "location")) setTimeout(() => (open.value = true), 150);
});
const valueBtn = ref<HTMLElement | null>(null);

function pickAuto() {
  for (const { profile } of sidePicks.value) {
    const st = store.profileStates[profile.id];
    if (!st) continue;
    st.node_id = null;
    st.mode = GLOBAL;
  }
  open.value = false;
}

function pickPlace(key: string) {
  for (const p of sidePicks.value) {
    const st = store.profileStates[p.profile.id];
    if (!st) continue;
    st.node_id = null;
    if (side.value === "ping") {
      if (p.sel.lowestPingForCity(key)) {
        st.cities = [key];
        st.mode = CITY;
      } else {
        st.mode = GLOBAL;
      }
    } else if (p.sel.areas.value?.[key]?.length) {
      st.countries = [key];
      st.mode = COUNTRY;
    } else {
      st.mode = GLOBAL;
    }
  }
  open.value = false;
  remember(key);
}

/* One-tap choices under the card: the places picked before (kept on this
 * computer, per side), then the nearest others, four in all. */
const CHIPS = 4;
const recentPing = useLocalStorage<string[]>("lz-play-from-recent", []);
const recentRegion = useLocalStorage<string[]>("lz-play-from-recent-region", []);
function remember(key: string) {
  const list = side.value === "ping" ? recentPing : recentRegion;
  list.value = [key, ...list.value.filter((k) => k !== key)].slice(0, 8);
}
/* Pinned places lead the chips, always (kept on this computer, per side).
 * A pinned place that is no longer offered stays, as its country and
 * "Unknown", so the player sees what went away. */
type Pin = { key: string; country: string; label: string };
const pinsPing = useLocalStorage<Pin[]>("lz-play-from-pins", []);
const pinsRegion = useLocalStorage<Pin[]>("lz-play-from-pins-region", []);
const pins = computed(() => (side.value === "ping" ? pinsPing : pinsRegion));
const isPinned = (key: string) => pins.value.value.some((p) => p.key === key);
function togglePin(place: Place) {
  const list = pins.value;
  list.value = isPinned(place.key)
    ? list.value.filter((p) => p.key !== place.key)
    : [...list.value, { key: place.key, country: place.country, label: place.label }];
}

type Chip = Place & { pinned: boolean; gone: boolean };
const chips = computed<Chip[]>(() => {
  const open = places.value.filter((c) => !c.locked);
  const byKey = new Map(open.map((c) => [c.key, c]));
  const out: Chip[] = pins.value.value.map((pin) => {
    const live = byKey.get(pin.key);
    return live
      ? { ...live, pinned: true, gone: false }
      : { key: pin.key, label: pin.label, country: pin.country, tag: "", ms: Infinity, locked: false, pinned: true, gone: true };
  });
  const taken = new Set(out.map((c) => c.key));
  const recent = side.value === "ping" ? recentPing.value : recentRegion.value;
  const fill = [...recent.map((k) => byKey.get(k)).filter((c): c is Place => !!c), ...open];
  for (const c of fill) {
    if (out.length >= Math.max(CHIPS, pins.value.value.length)) break;
    if (taken.has(c.key)) continue;
    taken.add(c.key);
    out.push({ ...c, pinned: false, gone: false });
  }
  return out;
});
</script>

<template>
  <div class="play-from" :class="{ 'play-from--intent': hasBoth }">
    <!-- The game's own switch, in the top-right corner. -->
    <div class="play-from__switch"><slot /></div>
    <!-- What the player wants: their ping, or their region. -->
    <div v-if="hasBoth" class="play-from__intent">
      <span class="play-from__intent-label">{{ t("$vuetify.title.playFrom.iWant") }}</span>
      <div class="play-from__seg" role="radiogroup">
        <button
          v-for="opt in intents"
          :key="opt.value"
          type="button"
          role="radio"
          class="play-from__seg-item"
          :class="{ 'play-from__seg-item--on': intent === opt.value }"
          :aria-checked="intent === opt.value"
          @click="intent = opt.value"
        >
          <v-icon :icon="opt.icon" size="14" />
          {{ opt.title }}
        </button>
      </div>
    </div>

    <div class="play-from__head">
      <!-- What it is set to, large: the bolt (or globe) for automatic, a flag. -->
      <div class="play-from__tile" :class="{ 'play-from__tile--flag': !!currentPlace?.country }">
        <FlagImg v-if="currentPlace?.country" :country="currentPlace.country" :height="34" />
        <v-icon
          v-else
          :icon="current === 'set' ? 'mdi-tune-variant' : side === 'ping' ? 'mdi-lightning-bolt' : 'mdi-earth'"
          color="primary"
          size="26"
        />
      </div>
      <div class="play-from__text">
        <div class="play-from__label">
          {{
            t(
              side === "region"
                ? "$vuetify.title.playFrom.regionLabel"
                : isGameTitle
                  ? "$vuetify.title.playFrom.pingLabel"
                  : "$vuetify.title.playFrom.label",
            )
          }}
        </div>
        <button ref="valueBtn" type="button" class="play-from__value" @click="open = !open">
          <template v-if="currentPlace">{{ currentPlace.label }}</template>
          <template v-else-if="current === 'set'">{{ t("$vuetify.title.playFrom.setInOptions") }}</template>
          <template v-else>
            {{ t(side === "ping" ? "$vuetify.title.playFrom.fastest" : "$vuetify.title.playFrom.automatic") }}
          </template>
          <v-icon :icon="open ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="22" class="play-from__chevron" />
        </button>
        <div class="play-from__sub">
          <template v-if="side === 'ping'">
            <template v-if="current === 'auto'">
              {{ nowOn ? `${t("$vuetify.title.playFrom.nowOn", nowOn)} · ` : "" }}{{ t("$vuetify.title.playFrom.switches") }}
            </template>
            <template v-else>
              {{ t(isGameTitle ? "$vuetify.title.playFrom.pingFixedHint" : "$vuetify.title.playFrom.fixedHint") }}
            </template>
          </template>
          <template v-else>
            {{ t(current === "auto" ? "$vuetify.title.playFrom.regionAutoHint" : "$vuetify.title.playFrom.regionHint") }}
          </template>
        </div>
      </div>

      <v-menu
        v-model="open"
        :target="valueBtn ?? undefined"
        location="bottom start"
        :close-on-content-click="false"
        max-height="460"
      >
        <v-card min-width="320" max-width="380" class="play-from__menu">
          <v-list density="comfortable" class="py-1">
            <v-list-item
              :active="current === 'auto'"
              color="primary"
              :prepend-icon="side === 'ping' ? 'mdi-lightning-bolt' : 'mdi-earth'"
              :title="t(side === 'ping' ? '$vuetify.title.playFrom.fastest' : '$vuetify.title.playFrom.automatic')"
              :subtitle="t(side === 'ping' ? '$vuetify.title.playFrom.fastestHint' : '$vuetify.title.playFrom.automaticHint')"
              @click="pickAuto"
            >
              <template v-if="current === 'auto'" #append>
                <v-icon icon="mdi-check" color="primary" size="18" />
              </template>
            </v-list-item>
            <v-list-subheader>
              {{ t(side === "ping" ? "$vuetify.title.playFrom.orCity" : "$vuetify.title.playFrom.orCountry") }}
            </v-list-subheader>
            <v-list-item
              v-for="place in listed"
              :key="place.key"
              :active="current === `${prefix}${place.key}`"
              color="primary"
              :class="{ 'play-from__locked': place.locked }"
              @click="place.locked ? ((open = false), plan.openUpgrade()) : pickPlace(place.key)"
            >
              <template #prepend>
                <FlagImg v-if="place.country" :country="place.country" :height="14" class="me-3" />
              </template>
              <v-list-item-title class="d-flex align-center ga-2">
                {{ place.label }}
                <v-chip v-if="side === 'ping' && place.key === bestPlace" size="x-small" color="success" variant="tonal">
                  {{ t("$vuetify.title.playFrom.bestPing") }}
                </v-chip>
              </v-list-item-title>
              <template #append>
                <v-icon v-if="place.locked" icon="mdi-cart-outline" size="16" color="amber" class="play-from__lock" />
                <template v-else>
                  <Ping :tag="place.tag" />
                  <v-btn
                    :icon="isPinned(place.key) ? 'mdi-pin' : 'mdi-pin-outline'"
                    :color="isPinned(place.key) ? 'primary' : undefined"
                    variant="text"
                    size="x-small"
                    class="ms-1 play-from__pin"
                    :class="{ 'play-from__pin--on': isPinned(place.key) }"
                    :aria-label="t(isPinned(place.key) ? '$vuetify.title.playFrom.unpin' : '$vuetify.title.playFrom.pin')"
                    @click.stop="togglePin(place)"
                  />
                </template>
              </template>
            </v-list-item>
            <div v-if="!places.some((c) => !c.locked)" class="play-from__empty">
              {{ t("$vuetify.title.playFrom.noCities") }}
            </div>
          </v-list>
          <v-divider />
          <v-list density="compact" class="py-1">
            <v-list-item
              prepend-icon="mdi-tune-variant"
              :title="t('$vuetify.title.playFrom.moreOptions')"
              :subtitle="t('$vuetify.title.playFrom.moreOptionsHint')"
              @click="open = false; fullOpen = true"
            />
          </v-list>
        </v-card>
      </v-menu>
    </div>

    <!-- More options: this side's full selector (several places, Multi
         Internet, Dedicated IP), opened at the same place. -->
    <ProfileRegionSelection
      :key="sideMain.profile.id"
      v-model:open="fullOpen"
      bare
      ignore-setup
      :target="valueBtn"
      :profile="sideMain.profile"
    />

    <!-- The automatic choice and your places, one tap away; "More" is the
         full list. -->
    <div class="play-from__chips">
      <v-chip
        :color="current === 'auto' ? 'primary' : undefined"
        :variant="current === 'auto' ? 'tonal' : 'flat'"
        size="small"
        class="play-from__chip"
        :prepend-icon="side === 'ping' ? 'mdi-lightning-bolt' : 'mdi-earth'"
        @click="pickAuto"
      >
        {{ t(side === "ping" ? "$vuetify.title.playFrom.fastestShort" : "$vuetify.title.playFrom.automatic") }}
      </v-chip>
      <v-chip
        v-for="place in chips"
        :key="place.key"
        :color="current === `${prefix}${place.key}` ? 'primary' : undefined"
        :variant="current === `${prefix}${place.key}` ? 'tonal' : 'flat'"
        size="small"
        class="play-from__chip"
        :class="{ 'play-from__chip--gone': place.gone }"
        :disabled="place.gone"
        @click="pickPlace(place.key)"
      >
        <v-icon v-if="place.pinned" icon="mdi-pin" size="12" class="me-1 play-from__chip-pin" />
        <FlagImg v-if="place.country" :country="place.country" :height="12" class="me-2" />
        <template v-if="place.gone">
          {{ countryName(place.country) || place.label }} · {{ t("$vuetify.title.playFrom.unknown") }}
        </template>
        <template v-else>
          {{ place.label }}
          <Ping :tag="place.tag" class="ms-2" />
        </template>
      </v-chip>
      <v-chip
        variant="flat"
        size="small"
        class="play-from__chip play-from__chip--more"
        append-icon="mdi-chevron-down"
        @click.stop="open = true"
      >
        {{ t("$vuetify.title.playFrom.more") }}
      </v-chip>
    </div>
    <!-- Changing region leaves the game's servers alone. -->
    <div v-if="side === 'region'" class="play-from__note">
      <v-icon icon="mdi-information-outline" size="14" />
      {{ t("$vuetify.title.playFrom.regionNote") }}
    </div>
  </div>
</template>

<style scoped>
.play-from__switch {
  position: absolute;
  top: 2px;
  inset-inline-end: 14px;
}

.play-from__switch:empty {
  display: none;
}

/* Keep the text clear of the switch. */
.play-from__intent,
.play-from:not(.play-from--intent) .play-from__head {
  padding-inline-end: 72px;
}

.play-from__intent {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 14px;
}

.play-from__intent-label {
  font-size: 0.8125rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

/* The intent switch: a dark track, the chosen one a lighter pill. */
.play-from__seg {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.play-from__seg-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border: none;
  border-radius: 999px;
  background: none;
  font: inherit;
  font-size: 0.8125rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.play-from__seg-item:hover {
  color: rgb(var(--v-theme-on-surface));
}

.play-from__seg-item--on {
  background: rgba(var(--v-theme-on-surface), 0.12);
  color: rgb(var(--v-theme-on-surface));
  font-weight: 500;
}

.play-from__note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding-inline-start: 68px;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.play-from__head {
  display: flex;
  align-items: center;
  gap: 16px;
}

.play-from__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
  padding-inline-start: 68px;
}

.play-from__chip {
  letter-spacing: normal;
}

.play-from__chip.v-chip--variant-flat {
  background: rgba(var(--v-theme-on-surface), 0.08);
}

.play-from__chip--more {
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.play-from {
  position: relative;
  padding: 16px 18px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
}

.v-theme--light .play-from {
  background: rgb(var(--v-theme-background));
}

.play-from__tile {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  overflow: hidden;
  border-radius: 12px;
  background: rgba(var(--v-theme-primary), 0.12);
}

/* A city's flag stands on its own, without the tile behind it. */
.play-from__tile--flag {
  background: none;
}

.play-from__text {
  flex: 1;
  min-width: 0;
}

.play-from__label {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.play-from__value {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  font-size: 1.25rem;
  font-weight: 500;
  line-height: 1.3;
}

.play-from__sub {
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

.play-from__value:hover .play-from__chevron,
.play-from__value:focus-visible .play-from__chevron {
  color: rgb(var(--v-theme-primary));
}

.play-from__chevron {
  color: rgba(var(--v-theme-on-surface), 0.6);
  transition: color 0.15s ease;
}

.play-from__change {
  letter-spacing: normal;
}

/* The menu's pin: shown on the row's hover, always once pinned. */
.play-from__pin {
  opacity: 0;
  transition: opacity 0.12s ease;
}

.play-from__menu .v-list-item:hover .play-from__pin,
.play-from__pin--on,
.play-from__pin:focus-visible {
  opacity: 1;
}

.play-from__chip-pin {
  color: rgb(var(--v-theme-primary));
}

.play-from__chip--gone {
  opacity: 0.6;
}

.play-from__locked {
  opacity: 0.6;
}

.play-from__lock {
  color: rgb(var(--v-theme-amber));
}

.play-from__empty {
  padding: 8px 16px 12px;
  font-size: 0.8125rem;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
</style>
