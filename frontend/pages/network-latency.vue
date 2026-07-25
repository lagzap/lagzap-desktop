<script setup lang="ts">
import Container from "~/components/layout/Container.vue";
import CountryFlag from "vue-country-flag-next";
import Ping from "~/components/network/Ping.vue";
import { useDisplay, useLocale } from "vuetify";
import { StartOptimizing, GetOptimizeProgress } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import ContinentIcon from "~/components/icons/ContinentIcon.vue";
import type { Node } from "~/bindings/github.com/lagzap/zap/data";
import type { DataTableHeader } from "vuetify";
import { useNetworkLatencyGrid } from "~/composables/useNetworkLatencyGrid";
import country from "country-list-js";

const locale = useLocale();
const { t } = locale;
const { mobile } = useDisplay();
const store = useStore();
const filterMode = ref("all");
const showFilters = ref(false);

const {
  stackFilter,
  transportFilter,
  interfaceFilter,
  visibleRegions,
  hasRelayFlag,
  getFilteredLatencyForNode,
  getFilteredLatencyForNodes,
  getFilteredLatencyForRegion,
  getNodeRouteTableRows,
} = useNetworkLatencyGrid();
const { getNodeLabel } = useNodeLocationLabel();

const filtersActive = computed(() => {
  return (
    interfaceFilter.value !== "best" ||
    stackFilter.value !== "all" ||
    transportFilter.value !== "all"
  );
});

const routeTableHeaders = computed<DataTableHeader[]>(() => [
  {
    title: t("$vuetify.networkLatency.routePath"),
    key: "path",
    sortable: false,
  },
  {
    title: t("$vuetify.networkLatency.routeStack"),
    key: "stack",
    sortable: false,
    width: "72px",
  },
  {
    title: t("$vuetify.networkLatency.routeTransport"),
    key: "transport",
    sortable: false,
    width: "72px",
  },
  {
    title: t("$vuetify.networkLatency.routePing"),
    key: "latencyMs",
    align: "center",
    sortable: true,
    width: "88px",
  },
  {
    title: t("$vuetify.networkLatency.routeLivePing"),
    key: "liveProbeMs",
    align: "center",
    sortable: true,
    width: "96px",
  },
  {
    title: t("$vuetify.networkLatency.routeAvailability"),
    key: "availability",
    sortable: false,
    width: "120px",
  },
  {
    title: t("$vuetify.networkLatency.routeAvailable"),
    key: "available",
    align: "center",
    sortable: true,
    width: "96px",
  },
]);

const stackFilterItems = computed(() => [
  {
    value: "all",
    title: t("$vuetify.networkLatency.filters.stackAll"),
  },
  {
    value: "ipv4",
    title: t("$vuetify.networkLatency.filters.stackIpv4"),
  },
  {
    value: "ipv6",
    title: t("$vuetify.networkLatency.filters.stackIpv6"),
  },
]);

const transportFilterItems = computed(() => [
  {
    value: "all",
    title: t("$vuetify.networkLatency.filters.transportAll"),
  },
  {
    value: "udp",
    title: t("$vuetify.networkLatency.filters.transportUdp"),
  },
  {
    value: "tcp",
    title: t("$vuetify.networkLatency.filters.transportTcp"),
  },
]);

const interfaceFilterItems = computed(() => [
  {
    value: "best",
    title: t("$vuetify.networkLatency.filters.bestInterface"),
  },
  ...store.interfaces.map((iface) => ({
    value: iface.Name,
    title: iface.Name,
  })),
]);

function onInterfaceFilterSelect(value: unknown) {
  if (typeof value === "string" && value) {
    interfaceFilter.value = value;
    return;
  }
  if (value && typeof value === "object" && "value" in value) {
    const v = (value as { value: unknown }).value;
    if (typeof v === "string" && v) {
      interfaceFilter.value = v;
    }
  }
}

const showRouteDialog = ref(false);
const selectedNode = ref<Node | null>(null);

const selectedNodeRouteRows = computed(() => {
  if (!selectedNode.value) {
    return [];
  }
  return getNodeRouteTableRows(selectedNode.value.id);
});

const selectedNodeTitle = computed(() => {
  if (!selectedNode.value) {
    return "";
  }
  return getNodeLabel(selectedNode.value);
});

function showRoutes(node: Node) {
  selectedNode.value = node;
  showRouteDialog.value = true;
}

function firstNodeIdForArea(nodes: Node[]): string {
  const relayNodes = nodes.filter(hasRelayFlag);
  return relayNodes.length > 0 ? relayNodes[0].id : "";
}

const areas = computed(() => {
  const allNodes = Object.values(store.nodes)
    .slice()
    .filter(hasRelayFlag)
    .sort((a, b) => {
      const countryA = country.findByIso2(a.country)?.name || "";
      const countryB = country.findByIso2(b.country)?.name || "";
      return countryA.localeCompare(countryB);
    })
    .reduce(
      (acc, node) => {
        const area = store.localized(node.city);
        acc[area] = acc[area] || [];
        acc[area].push(node);
        acc[area].sort((a, b) => a.name.localeCompare(b.name));
        return acc;
      },
      {} as Record<string, Node[]>
    );

  if (filterMode.value !== "all") {
    const filteredAreas: Record<string, Node[]> = {};
    Object.entries(allNodes).forEach(([area, nodes]) => {
      if (nodes[0]?.region === filterMode.value) {
        filteredAreas[area] = nodes;
      }
    });
    return filteredAreas;
  }

  return allNodes;
});

const areasByRegion = computed(() => {
  if (filterMode.value !== "all") {
    return { [filterMode.value]: areas.value };
  }

  const regionGroups: Record<string, Record<string, Node[]>> = {};
  Object.entries(areas.value).forEach(([area, nodes]) => {
    const regionTag = nodes[0]?.region;
    if (regionTag && visibleRegions.value.some((region) => region.tag === regionTag)) {
      regionGroups[regionTag] = regionGroups[regionTag] || {};
      regionGroups[regionTag][area] = nodes;
    }
  });

  const sortedRegionGroups: Record<string, Record<string, Node[]>> = {};
  visibleRegions.value.forEach((region) => {
    if (regionGroups[region.tag]) {
      sortedRegionGroups[region.tag] = regionGroups[region.tag];
    }
  });

  return sortedRegionGroups;
});

const regionLatencyByTag = computed(() => {
  // Touch filters so switching NIC/stack/transport always recomputes cards.
  void interfaceFilter.value;
  void stackFilter.value;
  void transportFilter.value;
  const result: Record<string, ReturnType<typeof getFilteredLatencyForRegion>> = {};
  for (const region of visibleRegions.value) {
    result[region.tag] = getFilteredLatencyForRegion(region.tag, areasByRegion.value);
  }
  return result;
});

const areaLatencyByKey = computed(() => {
  void interfaceFilter.value;
  void stackFilter.value;
  void transportFilter.value;
  const result: Record<string, ReturnType<typeof getFilteredLatencyForNodes>> = {};
  for (const [area, nodes] of Object.entries(areas.value)) {
    result[area] = getFilteredLatencyForNodes(nodes);
  }
  return result;
});

const nodeLatencyById = computed(() => {
  void interfaceFilter.value;
  void stackFilter.value;
  void transportFilter.value;
  const result: Record<string, ReturnType<typeof getFilteredLatencyForNode>> = {};
  for (const node of Object.values(store.nodes)) {
    if (hasRelayFlag(node)) {
      result[node.id] = getFilteredLatencyForNode(node.id);
    }
  }
  return result;
});

watch(visibleRegions, (regions) => {
  if (
    filterMode.value !== "all" &&
    !regions.some((region) => region.tag === filterMode.value)
  ) {
    filterMode.value = "all";
  }
});

async function optimize() {
  store.optimizeMinimized = false;
  store.optimizeProgress = {
    total_tests: 100,
    completed_tests: 0,
    is_complete: false,
    progress: 0,
    phase: "probe",
    probe_total: 0,
    probe_completed: 0,
    verify_total: 0,
    verify_completed: 0,
    interfaces: [],
  } as any;

  await StartOptimizing();

  // Poll RPC — Wails may wrap event payloads; this keeps the bar moving.
  // Ignore a premature is_complete until we've seen real work from this run
  // (stale completed snapshot from the previous optimize used to flash the panel).
  // Do not touch optimizeMinimized here — progress events used to force-expand.
  let sawLiveWork = false;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const progress = await GetOptimizeProgress();
      if (progress) {
        const probeTotal =
          progress.probe_total ?? (progress as any).probeTotal ?? 0;
        const probeDone =
          progress.probe_completed ?? (progress as any).probeCompleted ?? 0;
        const verifyTotal =
          progress.verify_total ?? (progress as any).verifyTotal ?? 0;
        const verifyDone =
          progress.verify_completed ?? (progress as any).verifyCompleted ?? 0;
        const pct = progress.progress ?? 0;
        if (probeTotal > 0 || probeDone > 0 || verifyTotal > 0 || verifyDone > 0 || pct > 0) {
          sawLiveWork = true;
        }
        const isComplete = !!(
          progress.is_complete ?? (progress as any).isComplete
        );
        if (isComplete && !sawLiveWork) {
          await new Promise((r) => setTimeout(r, 250));
          continue;
        }
        store.optimizeProgress = {
          total_tests:
            progress.total_tests ?? (progress as any).totalTests ?? 100,
          completed_tests:
            progress.completed_tests ?? (progress as any).completedTests ?? 0,
          is_complete: isComplete,
          progress: pct,
          phase: progress.phase || "probe",
          probe_total: probeTotal,
          probe_completed: probeDone,
          verify_total: verifyTotal,
          verify_completed: verifyDone,
          interfaces: progress.interfaces ?? [],
        } as any;
        if (isComplete) {
          break;
        }
      }
    } catch {
      // ignore transient RPC errors
    }
    if (
      !store.optimizing &&
      (store.optimizeProgress as any)?.probe_total > 0
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

</script>

<template>
  <div>
    <Container>
      <template #header>
        <v-app-bar-title class="text-subtitle-1">
          {{ t("$vuetify.networkLatency.latencyGrid") }}
        </v-app-bar-title>
      </template>
      <template #toolbar>
        <v-tooltip
          :text="t('$vuetify.networkLatency.filters.toggle')"
          location="bottom"
        >
          <template #activator="{ props: tipProps }">
            <v-btn
              v-bind="tipProps"
              icon
              :color="showFilters || filtersActive ? 'primary' : undefined"
              :density="mobile ? 'comfortable' : 'default'"
              @click="showFilters = !showFilters"
            >
              <v-badge
                :model-value="filtersActive"
                color="primary"
                dot
                floating
                offset-x="6"
                offset-y="6"
              >
                <v-icon
                  :icon="showFilters ? 'mdi-filter' : 'mdi-filter-outline'"
                />
              </v-badge>
            </v-btn>
          </template>
        </v-tooltip>
      </template>
      <v-card-text>
        <v-expand-transition>
          <v-row
            v-if="showFilters"
            dense
            class="mb-3"
          >
            <v-col cols="12" sm="4">
              <v-select
                :model-value="interfaceFilter"
                :items="interfaceFilterItems"
                item-value="value"
                item-title="title"
                :label="t('$vuetify.networkLatency.filters.interface')"
                density="compact"
                variant="outlined"
                hide-details
                @update:model-value="onInterfaceFilterSelect"
              />
            </v-col>
            <v-col cols="12" sm="4">
              <v-select
                v-model="stackFilter"
                :items="stackFilterItems"
                item-value="value"
                item-title="title"
                :label="t('$vuetify.networkLatency.filters.stack')"
                density="compact"
                variant="outlined"
                hide-details
              />
            </v-col>
            <v-col cols="12" sm="4">
              <v-select
                v-model="transportFilter"
                :items="transportFilterItems"
                item-value="value"
                item-title="title"
                :label="t('$vuetify.networkLatency.filters.transport')"
                density="compact"
                variant="outlined"
                hide-details
              />
            </v-col>
          </v-row>
        </v-expand-transition>

        <v-chip-group
          v-model="filterMode"
          color="primary"
          class="mb-3"
          filter
          mandatory
          show-arrows
        >
          <v-chip rounded size="large" value="all">
            <span>{{ t("$vuetify.network.allRegions") }}</span>
          </v-chip>
          <v-chip
            v-for="region in visibleRegions"
            :key="region.tag"
            rounded
            size="large"
            :value="region.tag"
            :disabled="region.active === false"
          >
            <template #prepend>
              <v-avatar size="24" class="me-2">
                <ContinentIcon :tag="region.tag" />
              </v-avatar>
            </template>
            <span>{{ store.localized(region.name) }}</span>
            <template #append>
              <div class="ms-2">
                <Ping
                  v-if="regionLatencyByTag[region.tag]?.latencyMs != null"
                  :tag="regionLatencyByTag[region.tag].routeTag"
                  :latency-ms="regionLatencyByTag[region.tag].latencyMs"
                />
              </div>
            </template>
          </v-chip>
        </v-chip-group>

        <v-row dense class="mb-16">
          <template v-if="filterMode === 'all'">
            <template
              v-for="[regionTag, regionAreas] in Object.entries(areasByRegion)"
              :key="regionTag"
            >
              <v-col cols="12" class="py-0">
                <v-list-subheader>
                  {{
                    store.localized(
                      visibleRegions.find((region) => region.tag === regionTag)?.name
                    )
                  }}
                </v-list-subheader>
              </v-col>
              <v-col
                v-for="[area, nodes] in Object.entries(regionAreas)"
                :key="area"
                cols="12"
                sm="6"
                md="4"
                lg="3"
                xl="2"
              >
                <v-menu
                  open-on-hover
                  :offset="10"
                  :close-on-content-click="false"
                >
                  <template #activator="{ props }">
                    <v-card v-bind="props">
                      <template #prepend>
                        <v-avatar>
                          <span style="height: 40px">
                            <CountryFlag :country="nodes[0].country" />
                          </span>
                        </v-avatar>
                      </template>
                      <template #title>
                        <span class="text-subtitle-1" style="line-height: 2.5">
                          {{ store.localized(nodes[0].city) }}
                        </span>
                      </template>
                      <template #append>
                        <Ping
                          v-if="areaLatencyByKey[area]?.latencyMs != null"
                          :tag="areaLatencyByKey[area].routeTag"
                          :latency-ms="areaLatencyByKey[area].latencyMs"
                        />
                        <Ping
                          v-else-if="interfaceFilter === 'best'"
                          :tag="firstNodeIdForArea(nodes)"
                        />
                        <span v-else class="text-caption text-medium-emphasis"
                          >-</span
                        >
                      </template>
                    </v-card>
                  </template>
                  <v-list>
                    <v-list-item
                      v-for="(node, i) in nodes"
                      :key="i"
                      :value="node.id"
                      @click="showRoutes(node)"
                    >
                      <v-list-item-title>
                        {{ getNodeLabel(node) }}
                      </v-list-item-title>
                      <template #append>
                        <Ping
                          v-if="nodeLatencyById[node.id]?.latencyMs != null"
                          :tag="nodeLatencyById[node.id].routeTag"
                          :latency-ms="nodeLatencyById[node.id].latencyMs"
                        />
                        <Ping
                          v-else-if="
                            interfaceFilter === 'best' && hasRelayFlag(node)
                          "
                          :tag="node.id"
                        />
                        <span
                          v-else-if="hasRelayFlag(node)"
                          class="text-caption text-medium-emphasis"
                          >-</span
                        >
                      </template>
                    </v-list-item>
                  </v-list>
                </v-menu>
              </v-col>
            </template>
          </template>
          <template v-else>
            <v-col
              v-for="[area, nodes] in Object.entries(areas)"
              :key="area"
              cols="12"
              sm="6"
              md="4"
              lg="3"
              xl="2"
            >
              <v-menu
                open-on-hover
                :offset="10"
                :close-on-content-click="false"
              >
                <template #activator="{ props }">
                  <v-card v-bind="props">
                    <template #prepend>
                      <v-avatar>
                        <span style="height: 40px">
                          <CountryFlag :country="nodes[0].country" />
                        </span>
                      </v-avatar>
                    </template>
                    <template #title>
                      <span class="text-subtitle-1" style="line-height: 2.5">
                        {{ store.localized(nodes[0].city) }}
                      </span>
                    </template>
                    <template #append>
                      <Ping
                        v-if="areaLatencyByKey[area]?.latencyMs != null"
                        :tag="areaLatencyByKey[area].routeTag"
                        :latency-ms="areaLatencyByKey[area].latencyMs"
                      />
                      <Ping
                        v-else-if="interfaceFilter === 'best'"
                        :tag="firstNodeIdForArea(nodes)"
                      />
                      <span v-else class="text-caption text-medium-emphasis"
                        >-</span
                      >
                    </template>
                  </v-card>
                </template>
                <v-list>
                  <v-list-item
                    v-for="(node, i) in nodes"
                    :key="i"
                    :value="node.id"
                    @click="showRoutes(node)"
                  >
                    <v-list-item-title>
                      {{ getNodeLabel(node) }}
                    </v-list-item-title>
                    <template #append>
                      <Ping
                        v-if="nodeLatencyById[node.id]?.latencyMs != null"
                        :tag="nodeLatencyById[node.id].routeTag"
                        :latency-ms="nodeLatencyById[node.id].latencyMs"
                      />
                      <Ping
                        v-else-if="
                          interfaceFilter === 'best' && hasRelayFlag(node)
                        "
                        :tag="node.id"
                      />
                      <span
                        v-else-if="hasRelayFlag(node)"
                        class="text-caption text-medium-emphasis"
                        >-</span
                      >
                    </template>
                  </v-list-item>
                </v-list>
              </v-menu>
            </v-col>
          </template>
        </v-row>
        <v-hover>
          <template #default="{ props }">
            <v-fab
              v-if="!store.optimizing"
              prepend-icon="mdi-fire"
              appear
              size="large"
              color="primary"
              variant="elevated"
              v-bind="props"
              :style="{
                position: 'fixed',
                bottom: '16px',
                [locale.isRtl.value ? 'left' : 'right']: '16px',
                zIndex: 10000,
              }"
              text="Optimize"
              @click="optimize()"
            />
          </template>
        </v-hover>
      </v-card-text>
    </Container>

    <v-dialog v-model="showRouteDialog" max-width="960">
      <v-card>
        <v-card-title class="text-subtitle-1">
          {{
            t("$vuetify.networkLatency.routeDialogTitle", [selectedNodeTitle])
          }}
        </v-card-title>
        <v-card-text>
          <v-data-table
            v-if="selectedNodeRouteRows.length > 0"
            :headers="routeTableHeaders"
            :items="selectedNodeRouteRows"
            item-value="key"
            density="compact"
            :items-per-page="10"
            class="bg-transparent"
          >
            <template #item.latencyMs="{ item }">
              <Ping
                v-if="item.latencyMs != null"
                :tag="item.routeTag"
                :latency-ms="item.latencyMs"
              />
              <span v-else class="text-medium-emphasis">—</span>
            </template>
            <template #item.liveProbeMs="{ item }">
              <Ping
                v-if="item.liveProbeMs != null"
                :tag="item.routeTag"
                :latency-ms="item.liveProbeMs"
              />
              <span v-else class="text-medium-emphasis">—</span>
            </template>
            <template #item.availability="{ item }">
              <div class="d-flex ga-1">
                <v-chip
                  size="x-small"
                  variant="tonal"
                  :color="item.icmp ? 'success' : 'default'"
                >
                  ICMP
                </v-chip>
                <v-chip
                  size="x-small"
                  variant="tonal"
                  :color="item.tcp ? 'success' : 'default'"
                >
                  TCP
                </v-chip>
                <v-chip
                  size="x-small"
                  variant="tonal"
                  :color="item.udp ? 'success' : 'default'"
                >
                  UDP
                </v-chip>
              </div>
            </template>
            <template #item.available="{ item }">
              <v-chip
                size="x-small"
                variant="flat"
                :color="item.available ? 'success' : 'error'"
              >
                {{
                  item.available
                    ? t("$vuetify.networkLatency.routeAvailable")
                    : t("$vuetify.networkLatency.routeUnavailable")
                }}
              </v-chip>
            </template>
          </v-data-table>
          <div v-else class="text-medium-emphasis py-4 text-center">
            {{ t("$vuetify.networkLatency.routeNoPaths") }}
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="showRouteDialog = false"
          >
            {{ t("$vuetify.close") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
