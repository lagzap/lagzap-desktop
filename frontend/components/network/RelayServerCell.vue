<script setup lang="ts">
import CountryFlag from "vue-country-flag-next";
import { useLocale } from "vuetify";
import type { Connection } from "~/types/monitoring";
import {
  isConnectionNotRelayed,
  useRelayIssueMessage,
} from "~/composables/useRelayIssue";

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
  <div v-else class="d-flex align-center flex-nowrap">
    <CountryFlag v-if="nodeCountry" :country="nodeCountry" size="small" />
    <span :class="[textClass, 'ms-1']">{{ getNodeLabel(connection.node_id) }}</span>
  </div>
</template>

<style scoped>
.relay-server-cell--issue {
  cursor: help;
}
</style>
