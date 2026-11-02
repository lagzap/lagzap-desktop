<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useLocale } from "vuetify";
import type { LinkQuality, LegQuality } from "~/bindings/github.com/lagzap/lagzap/adapter/models";
import { useNodeLocationLabel } from "~/composables/useNodeLocationLabel";
import { adminToolsAvailable } from "~/composables/useAdminToolsWindow";

// The live session's link as LagZap measures it from its own packets: a
// plain summary for everyone, every leg's numbers for admin builds.
const props = defineProps<{ link: LinkQuality }>();
const { t } = useLocale();
const { getNodeLabelByIp } = useNodeLocationLabel();

const admin = ref(false);
onMounted(async () => {
  admin.value = await adminToolsAvailable();
});

// A leg needs this many packets in the window before its numbers mean much.
const MIN_PACKETS = 20;
const LOSS_WARN = 5;
const LOSS_BAD = 20;
const QUEUE_WARN = 80;
const RESEND_WARN = 1;
const RESEND_BAD = 5;

function pathName(pathKey: string): string {
  const hops = pathKey.split("->").filter(Boolean);
  if (hops.length <= 1) return t("$vuetify.networkLatency.routeDirect");
  return hops
    .slice(0, -1)
    .map((ip) => getNodeLabelByIp(ip) || ip)
    .join(" → ");
}

function legName(leg: LegQuality): string {
  return `${leg.iface} · ${pathName(leg.path_key)} · ${leg.network.toUpperCase()}`;
}

const active = computed(() => (props.link.legs ?? []).filter((l) => !l.backup));
const measured = computed(() => active.value.filter((l) => l.received >= MIN_PACKETS || l.loss > 0));
const lossy = computed(() => measured.value.filter((l) => l.loss >= LOSS_WARN));
const queued = computed(() => measured.value.filter((l) => l.queue >= QUEUE_WARN));
const bursty = computed(() => measured.value.filter((l) => l.bursts > 0));

type Level = "good" | "warn" | "bad";
const level = computed<Level>(() => {
  const all = measured.value;
  if (props.link.resends >= RESEND_BAD) return "bad";
  if (all.length > 0 && all.every((l) => l.loss >= LOSS_BAD)) return "bad";
  if (lossy.value.length || queued.value.length || bursty.value.length || props.link.resends >= RESEND_WARN) {
    return "warn";
  }
  return "good";
});
const color = computed(() => ({ good: "success", warn: "warning", bad: "error" })[level.value]);

// The icon names the problem, in the headline's order: loss (or packets
// being resent), then lag building up, then bursts.
const icon = computed(() => {
  if (level.value === "good") return "mdi-antenna";
  const all = measured.value;
  if (props.link.resends >= RESEND_WARN || lossy.value.length || (all.length > 0 && all.every((l) => l.loss >= LOSS_BAD))) {
    return "mdi-signal-off";
  }
  if (queued.value.length) return "mdi-speedometer-slow";
  if (bursty.value.length) return "mdi-pulse";
  return "mdi-antenna";
});

// One sentence on what matters most right now.
const headline = computed(() => {
  const all = measured.value;
  if (all.length > 0 && all.every((l) => l.loss >= LOSS_BAD)) return t("$vuetify.title.profile.link.allLosing");
  if (props.link.resends >= RESEND_BAD) return t("$vuetify.title.profile.link.resending");
  if (lossy.value.length) {
    return lossy.value.length < all.length
      ? t("$vuetify.title.profile.link.someLosing")
      : t("$vuetify.title.profile.link.allLosing");
  }
  if (queued.value.length) return t("$vuetify.title.profile.link.queueing", queued.value[0].iface);
  if (bursty.value.length) return t("$vuetify.title.profile.link.bursting", bursty.value[0].iface);
  if (props.link.resends >= RESEND_WARN) return t("$vuetify.title.profile.link.fewResends");
  return t("$vuetify.title.profile.link.steady");
});

// Each adapter as one line: its best leg decides.
const adapters = computed(() => {
  const byIface = new Map<string, LegQuality[]>();
  for (const leg of active.value) {
    byIface.set(leg.iface, [...(byIface.get(leg.iface) ?? []), leg]);
  }
  return [...byIface.entries()].map(([iface, legs]) => {
    const best = legs.reduce((a, b) => (b.loss < a.loss ? b : a));
    let state = t("$vuetify.title.profile.link.adapterGood");
    let tone = "success";
    if (best.received < MIN_PACKETS && best.loss === 0) {
      state = t("$vuetify.title.profile.link.adapterIdle");
      tone = "medium-emphasis";
    } else if (best.loss >= LOSS_WARN) {
      state = t("$vuetify.title.profile.link.adapterLosing", Math.round(best.loss));
      tone = best.loss >= LOSS_BAD ? "error" : "warning";
    } else if (best.queue >= QUEUE_WARN) {
      state = t("$vuetify.title.profile.link.adapterDelayed", best.queue);
      tone = "warning";
    } else if (best.bursts > 0) {
      state = t("$vuetify.title.profile.link.adapterBursts");
      tone = "warning";
    }
    return { iface, state, tone };
  });
});

const legRows = computed(() =>
  [...(props.link.legs ?? [])].sort((a, b) => Number(a.backup) - Number(b.backup) || a.iface.localeCompare(b.iface)),
);

const pct = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;

// Table columns; each header explains itself on hover.
const columns = ["Leg", "Ping", "Loss", "First", "Lag", "Queue", "Bursts", "Stall"] as const;
</script>

<template>
  <!-- Opens and closes on click, so it stays put while reading it. -->
  <v-menu :close-on-content-click="false" location="top end" max-width="640">
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        icon
        variant="text"
        size="small"
        :aria-label="t('$vuetify.title.profile.link.title')"
      >
        <v-icon :icon="icon" :color="color" size="20" />
      </v-btn>
    </template>
    <v-card rounded="lg" class="pa-3 link-card">
      <div class="d-flex align-center ga-2 mb-1">
        <v-icon :icon="icon" :color="color" size="18" />
        <span class="text-subtitle-2">{{ t("$vuetify.title.profile.link.title") }}</span>
      </div>
      <div class="text-body-2 mb-2">{{ headline }}</div>
      <div class="text-caption text-medium-emphasis mb-2">
        {{ t("$vuetify.title.profile.link.roundTrip", props.link.rtt, props.link.jitter) }}
      </div>
      <div v-for="a in adapters" :key="a.iface" class="d-flex justify-space-between text-body-2">
        <span>{{ a.iface }}</span>
        <span :class="`text-${a.tone}`">{{ a.state }}</span>
      </div>

      <template v-if="admin">
        <v-divider class="my-2" />
        <div class="text-caption text-medium-emphasis mb-1">
          {{ t("$vuetify.title.profile.link.advanced", pct(props.link.resends)) }}
        </div>
        <v-table density="compact" class="link-table">
          <thead>
            <tr>
              <th v-for="col in columns" :key="col">
                <v-tooltip :text="t(`$vuetify.title.profile.link.tip${col}`)" location="top" max-width="300">
                  <template #activator="{ props: tipProps }">
                    <span v-bind="tipProps" class="link-col">{{ t(`$vuetify.title.profile.link.col${col}`) }}</span>
                  </template>
                </v-tooltip>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="leg in legRows" :key="leg.iface + leg.network + leg.path_key" :class="{ 'text-medium-emphasis': leg.backup }">
              <td>
                {{ legName(leg) }}
                <span v-if="leg.backup"> · {{ t("$vuetify.title.profile.link.backup") }}</span>
                <div class="text-medium-emphasis">{{ t("$vuetify.title.profile.link.packets", leg.received) }}</div>
              </td>
              <td>{{ leg.ping || "—" }}</td>
              <td>{{ pct(leg.loss) }}</td>
              <td>{{ pct(leg.first) }}</td>
              <td>{{ leg.lag }}</td>
              <td>{{ leg.queue }}</td>
              <td>{{ leg.bursts }}</td>
              <td>{{ leg.stall }}</td>
            </tr>
          </tbody>
        </v-table>
      </template>
    </v-card>
  </v-menu>
</template>

<style scoped>
.link-card {
  min-width: 420px;
}
.link-col {
  cursor: help;
  border-bottom: 1px dotted currentColor;
}
.link-table :deep(th),
.link-table :deep(td) {
  font-size: 12px;
  padding: 2px 6px !important;
  white-space: nowrap;
}
</style>
