<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import { useLocale } from "vuetify";
import type { Connection } from "~/types/monitoring";
import {
  isConnectionNotRelayed,
  useRelayIssueMessage,
} from "~/composables/useRelayIssue";
import { useProfileWireGuard } from "~/composables/useProfileWireGuard";

/** "LagZap Server" cell: relay location, or a warning with the reason when
 * the connection is not relayed (or relayed outside the profile selection). */
const props = withDefaults(
  defineProps<{ connection: Connection; textClass?: string }>(),
  { textClass: "text-caption" }
);

const store = useStore();
const { t } = useLocale();
const { getNodeLabel } = useNodeLocationLabel();
const issueMessage = useRelayIssueMessage();

const notRelayed = computed(() => isConnectionNotRelayed(props.connection));
const message = computed(() => issueMessage(props.connection));
const nodeCountry = computed(
  () => store.nodes?.[props.connection.node_id ?? ""]?.country
);
/** Sent straight out (split tunnel / Direct, no LagZap server). */
const direct = computed(() => !props.connection.node_id);

/** Gone through the profile's Dedicated IP (WireGuard): the connection is in
 * the tunnel's LagZap session. Its server's country follows the relay. */
const dedicatedIp = computed(() => {
  const profileId = props.connection.profile_id;
  const group = props.connection.group_id;
  if (!profileId || !group) return null;
  const wireGuard = useProfileWireGuard(profileId);
  if (wireGuard.status.value.session !== group || !wireGuard.selected.value) return null;
  return wireGuard.selected.value;
});
</script>

<template>
  <v-tooltip v-if="message" :text="message" location="top" max-width="320">
    <template #activator="{ props: tip }">
      <div v-bind="tip" class="d-flex align-center flex-nowrap relay-server-cell--issue">
        <template v-if="notRelayed">
          <v-icon icon="mdi-alert-outline" color="warning" size="16" />
          <span :class="[textClass, 'ms-1 text-warning']">
            {{ t("$vuetify.connections.notRelayed") }}
          </span>
        </template>
        <template v-else>
          <CountryFlag v-if="nodeCountry" :country="nodeCountry" size="small" />
          <span :class="[textClass, 'ms-1']">{{ getNodeLabel(connection.node_id) }}</span>
          <v-icon icon="mdi-alert-outline" color="warning" size="14" class="ms-1" />
        </template>
      </div>
    </template>
  </v-tooltip>
  <!-- No LagZap server: Direct, and the adapter it went out on. -->
  <div v-else-if="direct" class="d-flex align-center flex-nowrap text-medium-emphasis">
    <v-icon icon="mdi-call-split" size="16" />
    <span :class="[textClass, 'ms-1']">
      {{ t("$vuetify.connections.direct") }}<template v-if="connection.iface"> · {{ connection.iface }}</template>
    </span>
    <template v-if="dedicatedIp">
      <v-icon icon="mdi-arrow-right" size="14" class="mx-1" />
      <CountryFlag v-if="dedicatedIp.country" :country="dedicatedIp.country" size="small" />
      <span v-tooltip="dedicatedIp.name" :class="[textClass, 'ms-1 relay-server-cell__wg']">{{ dedicatedIp.name || t("$vuetify.connections.dedicatedIp") }}</span>
    </template>
  </div>
  <div v-else class="d-flex align-center flex-nowrap">
    <CountryFlag v-if="nodeCountry" :country="nodeCountry" size="small" />
    <span :class="[textClass, 'ms-1']">{{ getNodeLabel(connection.node_id) }}</span>
    <!-- Then the Dedicated IP (WireGuard) it leaves from. -->
    <template v-if="dedicatedIp">
      <v-icon icon="mdi-arrow-right" size="14" class="mx-1" />
      <CountryFlag v-if="dedicatedIp.country" :country="dedicatedIp.country" size="small" />
      <span v-tooltip="dedicatedIp.name" :class="[textClass, 'ms-1 relay-server-cell__wg']">{{ dedicatedIp.name || t("$vuetify.connections.dedicatedIp") }}</span>
    </template>
  </div>
</template>

<style scoped>
.relay-server-cell--issue {
  cursor: help;
}

/* The Dedicated IP's config name, cut to fit (its full name on hover). */
.relay-server-cell__wg {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
