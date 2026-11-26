<script setup lang="ts">
import { useLocale } from "vuetify";
import type { LoadBalanceShare } from "~/bindings/github.com/lagzap/lagzap/adapter";
import AdapterPing from "~/components/network/AdapterPing.vue";
import InternetCard from "~/components/title/InternetCard.vue";
import InternetRow from "~/components/title/InternetRow.vue";
import LoadBalanceWeight from "~/components/title/LoadBalanceWeight.vue";
import { localDigits } from "~/utils/localeFormat";

// The internet a High traffic profile's traffic goes out through, as a card
// (InternetCard) with one choice of three, each saying where traffic goes:
//   - Default internet: whatever Windows uses (the card dashed);
//   - one internet: all of it through that one;
//   - Load balance: new connections spread over several (checkboxes under
//     it). Untouched, the ticked ones are those flagged Load balance on the
//     Multi Internet page ("pool"); ticking or unticking one makes the ticked
//     ones the profile's own ("pick"), and unticking down to one is that one
//     internet. Each shows its share (a chip to set its weight, and a bar).
// A Dedicated IP is one tunnel on one internet: Load balance cannot be picked.
export type LoadBalanceMode = "off" | "pool" | "pick";

const props = defineProps<{
  mode: LoadBalanceMode;
  /** Internets listed: the pool's (pool) or every one to pick from (pick). */
  adapters: string[];
  /** Picked internets (pick). */
  selected: string[];
  /** Off: the internets to choose one from, and the one picked ("" = the
   * Default internet, what Windows uses). */
  singleAdapters: string[];
  single: string;
  /** The internet Windows uses now (what "" means). */
  systemDefault?: string;
  missing: string[];
  /** Internets with no internet now (LagZap uses another meanwhile). */
  down?: string[];
  shares: Record<string, LoadBalanceShare>;
  loading: boolean;
  disabled?: boolean;
  /** The menu is open: only then the pings stream. */
  live?: boolean;
  /** Opened from a tip's Set up: stands out for a moment. */
  highlight?: boolean;
  icon: (name: string) => string;
  /** Why load balancing cannot be on (a Dedicated IP): the switch is off
   * and fixed, one internet is picked below. */
  locked?: string;
  /** How many internets the Multi Internet page flags for load balancing:
   * two or more and following the settings balances. */
  poolSize?: number;
}>();
const emit = defineEmits<{
  mode: [mode: LoadBalanceMode];
  pick: [name: string];
  single: [name: string];
  weight: [name: string, weight: number];
  refresh: [];
  /** Back to the settings: nothing of its own for its internets. */
  reset: [];
}>();
const { t } = useLocale();

const inUse = (name: string) => props.selected.includes(name);
const count = computed(() => props.adapters.filter(inUse).length);
/** Settings has fewer than two internets flagged: nothing is spread. */
const poolTooSmall = computed(() => props.mode === "pool" && count.value < 2);

/** Nothing of its own: it follows the settings (the Multi Internet page's
 * load balancing, else the Default internet). Dashed, never primary. */
const following = computed(() => props.mode === "pool" && !props.single);
const settingsBalance = computed(() => (props.poolSize ?? 0) >= 2);
/** Load balance in use (its own, or the settings'). */
const balancing = computed(() => (following.value ? settingsBalance.value : props.mode !== "off"));
/** Off: the one internet picked, "" for the Default internet. */
const choice = computed(() => (balancing.value ? "balance" : props.single || "default"));
const defaultLabel = () => t("$vuetify.title.profile.server.loadBalanceDefaultInternet");
const isDown = (name: string) => !!props.down?.includes(name);
/** Not connected, or no internet: in the warning color, saying which. */
const broken = (name: string) => props.missing.includes(name) || isDown(name);
const brokenText = (name: string) =>
  isDown(name) && !props.missing.includes(name) ? t("$vuetify.title.profile.server.noInternetShort") : undefined;

/** One internet while load balancing: the one Windows uses, else the first. */
function pickOne() {
  const names = props.singleAdapters;
  emit("single", props.systemDefault && names.includes(props.systemDefault) ? props.systemDefault : (names[0] ?? ""));
}
/** The Default internet: following the settings when they balance
 * nothing anyway, else its own choice. */
function pickDefault() {
  if (following.value && !settingsBalance.value) return;
  if (!settingsBalance.value) emit("reset");
  else emit("single", "");
}
/** Load balance: the settings' (following them), or its own ticked ones. */
function pickBalance() {
  if (props.locked || balancing.value) return;
  emit("reset");
}
</script>

<template>
  <InternetCard
    settings-link
    class="mx-3 my-2"
    :on="!following"
    :title="t('$vuetify.title.profile.server.internetTitle')"
    :icon="balancing ? 'mdi-scale-balance' : single ? icon(single) : 'mdi-lan'"
    no-toggle
    :disabled="disabled"
    refresh
    :loading="loading"
    :highlight="highlight"
    @refresh="emit('refresh')"
  >
    <!-- Set here: back to the settings — words, not an icon (the refresh
         beside it is round arrows too). -->
    <template
      v-if="!following"
      #action>
      <v-btn
        v-tooltip="t('$vuetify.title.profile.followSettings')"
        size="x-small"
        variant="tonal"
        class="text-none me-1"
        :disabled="disabled"
        @click.stop="emit('reset')"
      >
        {{ t("$vuetify.title.profile.useSettings") }}
      </v-btn>
    </template>
    <!-- Where its traffic goes now. -->
    <template #state>
      <span
        v-if="following"
        class="text-medium-emphasis">
        {{ t("$vuetify.title.profile.orderFromSettings", balancing
          ? t("$vuetify.title.profile.server.loadBalanceCount", localDigits(count))
          : systemDefault ? t("$vuetify.title.profile.server.allTrafficDefault", systemDefault) : defaultLabel()) }}
      </span>
      <span
        v-else-if="balancing && poolTooSmall"
        class="text-medium-emphasis">
        {{ t("$vuetify.title.profile.server.loadBalancePoolOff") }}
      </span>
      <span
        v-else-if="balancing"
        class="text-primary d-flex align-center">
        <v-icon
          size="14"
          class="me-1">
          mdi-check
        </v-icon>
        {{ t("$vuetify.title.profile.server.loadBalanceCount", localDigits(count)) }}
      </span>
      <span
        v-else-if="single && broken(single)"
        class="text-warning">
        {{ t(isDown(single) && !missing.includes(single) ? "$vuetify.title.profile.server.allTrafficViaDown" : "$vuetify.title.profile.ifaceMissing", single) }}
      </span>
      <span
        v-else-if="single"
        class="text-primary">
        {{ t("$vuetify.title.profile.server.allTrafficVia", single) }}
      </span>
      <span
        v-else-if="systemDefault"
        class="text-medium-emphasis">
        {{ t("$vuetify.title.profile.server.allTrafficDefault", systemDefault) }}
      </span>
      <span
        v-else
        class="text-medium-emphasis">
        {{ defaultLabel() }}
      </span>
    </template>

    <!-- Default internet: Windows' choice. -->
    <InternetRow
      :name="defaultLabel()"
      icon="mdi-auto-fix"
      radio
      :picked="choice === 'default'"
      :disabled="disabled"
      @pick="pickDefault"
    >
      <template #append>
        <span
          v-if="systemDefault"
          class="text-caption text-medium-emphasis">{{ systemDefault }}</span>
      </template>
    </InternetRow>

    <!-- One internet: each, or while load balancing one row to come back. -->
    <template v-if="!balancing">
      <InternetRow
        v-for="name in singleAdapters"
        :key="name"
        :name="name"
        :icon="icon(name)"
        radio
        :picked="single === name"
        :missing="broken(name)"
        :missing-text="brokenText(name)"
        :disabled="disabled"
        @pick="emit('single', name)"
      >
        <template
          v-if="!broken(name) && live"
          #append>
          <AdapterPing :name="name" />
        </template>
      </InternetRow>
    </template>
    <InternetRow
      v-else
      :name="t('$vuetify.title.profile.server.oneInternet')"
      icon="mdi-lan"
      radio
      :picked="false"
      :disabled="disabled"
      @pick="pickOne"
    />

    <!-- Load balance: several at once, by weight. -->
    <InternetRow
      :name="t('$vuetify.title.profile.server.loadBalance')"
      icon="mdi-scale-balance"
      radio
      :picked="balancing"
      :disabled="disabled || !!locked"
      @pick="pickBalance"
    >
      <template
        v-if="locked"
        #append>
        <span class="text-caption text-medium-emphasis">
          {{ locked }}
        </span>
      </template>
    </InternetRow>
    <div
      v-if="balancing"
      class="load-balance__internets">
      <v-list-item
        v-if="poolTooSmall"
        density="compact"
        rounded="lg"
        class="px-2"
        to="/multi-internet">
        <template #title>
          <span class="text-caption text-medium-emphasis">
            {{ t("$vuetify.title.profile.server.loadBalancePoolHint") }}
          </span>
        </template>
        <template #append>
          <v-icon size="16">
            mdi-chevron-right
          </v-icon>
        </template>
      </v-list-item>
      <InternetRow
        v-for="name in adapters"
        :key="name"
        :name="name"
        :icon="icon(name)"
        :picked="inUse(name)"
        :missing="broken(name)"
        :missing-text="brokenText(name)"
        :disabled="disabled"
        :share="inUse(name) && !broken(name) ? shares[name]?.percent : undefined"
        @pick="emit('pick', name)"
      >
        <template
          v-if="!broken(name)"
          #append>
          <LoadBalanceWeight
            v-if="inUse(name)"
            :share="shares[name]"
            @set="(weight: number) => emit('weight', name, weight)"
          />
          <AdapterPing
            v-if="live"
            :name="name" />
        </template>
      </InternetRow>
    </div>
  </InternetCard>
</template>

<style scoped>
/* Load balance's internets, under its choice. */
.load-balance__internets {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-inline-start: 24px;
}
</style>
