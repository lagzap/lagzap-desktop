<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, computed, watch } from "vue";
import { useStore } from "~/stores";
import { useLocale } from "vuetify";
import * as echarts from "echarts";

import { chartColors } from "~/utils/colors";

interface NodeLike {
  id?: string;
  name?: string;
  city?: Record<string, string>;
  longitude?: number;
  latitude?: number;
  ipv4?: string;
  ipv6?: string;
  Ipv4?: string;
}

interface HopLike {
  ip?: string | null;
}

interface RouteLike {
  min_latency?: number;
  avg_latency?: number;
  score?: number;
  hops?: HopLike[];
}

interface RelayLike {
  routes?: RouteLike[];
  tag?: string;
  Tag?: string;
  TagName?: string;
  TagId?: string;
  addr?: string;
  Addr?: string;
  address?: string;
  AddrIp?: string;
}

type NodePoint = {
  name?: string;
  value: number[];
  nodeId?: string;
  score?: number | null;
  display_latency?: number;
  isUser?: boolean;
  isDest?: boolean;
  label?: Record<string, unknown>;
};

const props = defineProps<{ modelValue: string | null }>();
const emit = defineEmits(["update:modelValue"]);

const store = useStore();
const locale = useLocale();
const { getNodeLabel } = useNodeLocationLabel();
const t = locale.t;

const chartRef = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | null = null;

const selected = computed<string | null>({
  get: () => props.modelValue ?? null,
  set: (v) => emit("update:modelValue", v),
});

const { user } = useSanctumAuth<DataResponse>();
const client: ClientInfo = user.value.client;

const ipToNodeMap = computed(() => {
  const map = new Map<string, NodeLike>();
  for (const node of Object.values(store.nodes ?? {})) {
    const n = node as NodeLike;
    if (n.ipv4) map.set(n.ipv4, n);
    if (n.ipv6) map.set(n.ipv6, n);
  }
  return map;
});

const nodePrimaryRouteInfo = computed(() => {
  const map = new Map<
    string,
    { minLatency: number | null; score: number | null }
  >();
  for (const n of Object.values(store.nodes ?? {})) {
    const node = n as NodeLike;
    if (!node.id) continue;

    const relay =
      ((store.routes ?? {})[`${node.id}-ipv4-udp`] as RelayLike | undefined) ||
      ((store.routes ?? {})[`${node.id}-ipv4-tcp`] as RelayLike | undefined);

    if (relay?.routes?.[0]) {
      const r = relay.routes[0];
      const minLatency = r.min_latency ?? null;
      const score = r.score ?? null;
      map.set(node.id, { minLatency, score });
    } else {
      map.set(node.id, { minLatency: null, score: null });
    }
  }
  return map;
});

const ipToCoord = (ip: string | null | undefined) => {
  if (!ip) return null;

  const node = ipToNodeMap.value.get(ip);
  if (node) {
    return [node.longitude ?? 0, node.latitude ?? 0];
  }

  if (!ip.includes(".") && !ip.includes(":")) {
    const byId = (Object.values(store.nodes ?? {}) as NodeLike[]).find(
      (n) => n.id === ip || n.name === ip
    );
    if (byId) return [byId.longitude ?? 0, byId.latitude ?? 0];
  }
  return null;
};

const getLocalizedNodeName = (node: NodeLike) => {
  if (node.id) {
    return getNodeLabel(node.id);
  }
  return node.name || "-";
};

function buildSeriesForSelection(nodeId: string | null) {
  const nodesData: NodePoint[] = [];
  for (const nRaw of Object.values(store.nodes ?? {})) {
    const n = nRaw as NodeLike;
    if (!n.id || !Number.isFinite(n.longitude) || !Number.isFinite(n.latitude))
      continue;

    const routeInfo = nodePrimaryRouteInfo.value.get(n.id);
    const minLatency = routeInfo?.minLatency ?? -1;
    const score = routeInfo?.score ?? null;

    if (!nodeId || n.id !== nodeId) {
      nodesData.push({
        name: getLocalizedNodeName(n),
        value: [n.longitude as number, n.latitude as number, minLatency],
        nodeId: n.id,
        score: score,
        display_latency: minLatency,
      });
    }
  }

  // add current client/user location as a special marker so it appears on the map
  if (Number.isFinite(client.longitude) && Number.isFinite(client.latitude)) {
    nodesData.push({
      name: user.value?.user?.name ?? client.ip ?? "you",
      value: [client.longitude, client.latitude, 0],
      isUser: true,
      label: {
        show: true,
        formatter: user.value?.user?.name ?? client.ip ?? "you",
        position: "inside",
        fontSize: 12,
        color: "#fff",
        backgroundColor: "transparent",
      },
    });
  }

  return { nodesData };
}

function updateChart() {
  if (!chart) return;
  const selection = selected.value;
  const { nodesData } = buildSeriesForSelection(selection ?? null);

  const scatterSeries = {
    type: "scatter",
    coordinateSystem: "geo",
    data: nodesData,
    symbol: "circle",
    symbolSize: 20,
    labelLayout: { hideOverlap: true },
    itemStyle: {
      color: (params: {
        data?: { score?: number | null; isUser?: boolean; isDest?: boolean };
      }) => {
        const s = params?.data?.score ?? null;
        if (params?.data?.isUser) return chartColors.userMarker;
        if (params?.data?.isDest) return chartColors.destinationMarker;
        if (s === null || s === undefined || s < 0)
          return chartColors.onSurface;
        if (s >= 80) return chartColors.success;
        if (s >= 70) return chartColors.warning;
        return chartColors.error;
      },
      borderColor: (params: { data?: { isUser?: boolean } }) =>
        params?.data?.isUser ? "#fff" : undefined,
      borderWidth: (params: { data?: { isUser?: boolean } }) =>
        params?.data?.isUser ? 2 : 0,
    },
    encode: { value: 2 },
    label: {
      show: true,
      formatter: (p: { value?: number[] }) =>
        `${Math.max(0, p.value?.[2] ?? 0)}`,
      position: "inside",
      fontSize: 10,
      fontFamily: "Roboto",
      color: "#fff",
      textBorderColor: "rgba(0,0,0,0.6)",
      textBorderWidth: 2,
    },
    zlevel: 3,
  };

  const option: any = {
    textStyle: { fontFamily: chartFontFamily() },
    tooltip: {
      formatter: (params: {
        seriesType?: string;
        data?: {
          name?: string;
          value?: unknown;
          display_latency?: number;
          score?: number | null;
        };
        name?: string;
      }) => {
        if (
          params.seriesType === "scatter" &&
          params.data &&
          params.data.name
        ) {
          const latency = params.data.display_latency;
          const score = params.data.score;
          let tooltip = `${params.data.name}: `;
          if (latency !== undefined && latency >= 0) {
            tooltip += formatMs(latency);
          }
          if (score !== null && score !== undefined && score >= 0) {
            tooltip += `<br/>${score}`;
          }
          return tooltip;
        }
        if (
          params.seriesType === "lines" &&
          params.data &&
          params.data.value !== undefined
        )
          return `latency: ${formatMs(Number(params.data.value))}`;
        return params.name ?? "";
      },
      backgroundColor: "rgba(0,0,0,.9)",
      textStyle: { color: chartColors.onSurface, fontFamily: chartFontFamily() },
    },
    backgroundColor: "transparent",
    geo: {
      map: "world",
      roam: true,
      itemStyle: {
        areaColor: chartColors.mapArea,
        borderColor: chartColors.mapBorder,
        borderWidth: 1.2,
        opacity: 1,
      },
      emphasis: {
        itemStyle: {
          areaColor: chartColors.mapEmphasisArea,
          borderColor: chartColors.mapEmphasisBorder,
          borderWidth: 1.4,
        },
      },
    },
    series: [],
  };

  if ((nodesData ?? []).length > 0) option.series.push(scatterSeries);

  try {
    const sel = selection;
    if (sel && store.routes) {
      const relayKeyUdp = `${sel}-ipv4-udp`;
      const relayKeyTcp = `${sel}-ipv4-tcp`;
      const relay =
        ((store.routes ?? {})[relayKeyUdp] as RelayLike | undefined) ||
        ((store.routes ?? {})[relayKeyTcp] as RelayLike | undefined);
      if (relay && Array.isArray(relay.routes)) {
        const sorted = ([...relay.routes] as RouteLike[])
          .sort((a, b) => {
            if ((b.score ?? -1) !== (a.score ?? -1))
              return (b.score ?? -1) - (a.score ?? -1);
            return (
              (a.min_latency ?? Number.MAX_SAFE_INTEGER) -
              (b.min_latency ?? Number.MAX_SAFE_INTEGER)
            );
          })
          .slice(0, 4);

        const linesData: Array<{
          coords: number[][];
          value: number;
          score?: number;
        }> = [];
        const userCoord = [client.longitude, client.latitude] as number[];
        let destNode: NodeLike | null = null;
        if (sel && (store.nodes ?? {})[sel])
          destNode = (store.nodes ?? {})[sel] as NodeLike;
        if (!destNode && relay) {
          const relayTag =
            relay.tag ?? relay.Tag ?? relay.TagName ?? relay.TagId ?? null;
          const relayAddr =
            relay.addr ?? relay.Addr ?? relay.address ?? relay.AddrIp ?? null;
          if (relayTag && (store.nodes ?? {})[relayTag])
            destNode = (store.nodes ?? {})[relayTag] as NodeLike;
          if (!destNode && relayTag)
            destNode =
              (Object.values(store.nodes ?? {}) as NodeLike[]).find(
                (n) => n.id === relayTag || n.name === relayTag
              ) || null;
          if (!destNode && relayAddr)
            destNode =
              (Object.values(store.nodes ?? {}) as NodeLike[]).find(
                (n) => (n.ipv4 ?? n.Ipv4) === relayAddr
              ) || null;
        }

        let destCoord: number[] | null =
          destNode &&
          Number.isFinite(destNode.longitude ?? NaN) &&
          Number.isFinite(destNode.latitude ?? NaN)
            ? [destNode.longitude as number, destNode.latitude as number]
            : null;

        if (!destCoord && Array.isArray(sorted) && sorted.length > 0) {
          for (const r of sorted) {
            try {
              const hops = r.hops ?? [];
              if (!Array.isArray(hops) || hops.length === 0) continue;
              const lastHop = hops[hops.length - 1];
              const lip = lastHop?.ip ?? null;
              if (!lip) continue;
              const c = ipToCoord(lip);
              if (c) {
                destCoord = c;
                break;
              }
            } catch (e) {}
          }
        }

        for (const r of sorted) {
          try {
            if (!r || !Array.isArray(r.hops ?? [])) continue;
            const coords: number[][] = [];
            if (userCoord) coords.push(userCoord);
            for (const h of r.hops ?? []) {
              const ip = h?.ip ?? null;
              const c = ip ? ipToCoord(ip) : null;
              if (c) coords.push(c as number[]);
            }
            if (destCoord) {
              const last = coords.length > 0 ? coords[coords.length - 1] : null;
              const sameAsLast =
                last && last[0] === destCoord[0] && last[1] === destCoord[1];
              if (!sameAsLast) coords.push(destCoord);
            }
            const dedup: number[][] = [];
            for (const c of coords) {
              if (!c) continue;
              const last = dedup.length > 0 ? dedup[dedup.length - 1] : null;
              if (!last || last[0] !== c[0] || last[1] !== c[1]) dedup.push(c);
            }
            if (dedup.length >= 2) {
              for (let si = 0; si < dedup.length - 1; si++) {
                const a = dedup[si];
                const b = dedup[si + 1];
                if (!a || !b) continue;
                linesData.push({
                  coords: [a, b],
                  value: r.min_latency ?? r.avg_latency ?? 0,
                  score: r.score,
                });
              }
            }
          } catch (e) {}
        }

        if (destCoord) {
          const destRouteInfo = nodePrimaryRouteInfo.value.get(sel);
          const destLatency = destRouteInfo?.minLatency ?? -1;
          const localizedName = getLocalizedNodeName(destNode);
          nodesData.push({
            name: localizedName,
            value: [destCoord[0], destCoord[1], destLatency],
            isDest: true,
            display_latency: destLatency,
          });
        }

        if (linesData.length > 0) {
          option.series.push({
            type: "lines",
            coordinateSystem: "geo",

            lineStyle: {
              width: 2,
              color: chartColors.success,
              opacity: 0.5,
              curveness: 0.3,
            },
            data: linesData.map((line) => ({
              coords: line.coords,
              value: line.value,
              lineStyle: {
                cap: "round",
                join: "miter",
                curveness: 0.2,
              },
            })),
            zlevel: 3,
          });
          try {
            const allCoords = ([] as number[][]).concat(
              ...linesData.map((d) => d.coords || [])
            );
            if (allCoords && allCoords.length > 0) {
              let minLon = 180,
                maxLon = -180,
                minLat = 90,
                maxLat = -90;
              for (const c of allCoords) {
                if (!c || c.length < 2) continue;
                const lon = c[0];
                const lat = c[1];
                if (lon < minLon) minLon = lon;
                if (lon > maxLon) maxLon = lon;
                if (lat < minLat) minLat = lat;
                if (lat > maxLat) maxLat = lat;
              }
              if (minLon <= maxLon && minLat <= maxLat) {
                const centerLon = (minLon + maxLon) / 2;
                const centerLat = (minLat + maxLat) / 2;
                const span = Math.max(maxLon - minLon, maxLat - minLat);
                let zoom = 3;
                if (span < 0.03) zoom = 11;
                else if (span < 0.08) zoom = 10;
                else if (span < 0.2) zoom = 9;
                else if (span < 0.5) zoom = 8;
                else if (span < 1) zoom = 7;
                else if (span < 2) zoom = 6;
                else if (span < 5) zoom = 5;
                else if (span < 10) zoom = 4;
                else zoom = 3;
                zoom = Math.max(8, zoom);
                option.geo = option.geo || {};
                option.geo.center = [centerLon, centerLat];
                option.geo.zoom = zoom;
              }
            }
          } catch (e) {}
        }
      }
    }
  } catch (e) {}

  try {
    chart.setOption(option, { notMerge: true });
  } catch (e) {
    try {
      chart.setOption(option, { notMerge: true });
    } catch (e) {}
  }
}

async function initChart() {
  if (!chartRef.value) return;
  chart = echarts.init(chartRef.value as HTMLDivElement);
  try {
    const url = new URL("../../assets/world.json", import.meta.url).href;
    const resp = await fetch(url);
    if (resp.ok) {
      const geo = await resp.json();
      echarts.registerMap("world", geo);
    }
  } catch (e) {}
  updateChart();
  window.addEventListener("resize", onResize);
  try {
    chart.on("click", (params: any) => {
      try {
        if (
          params &&
          params.componentType === "series" &&
          params.seriesType === "scatter" &&
          params.data &&
          params.data.nodeId
        )
          selected.value = params.data.nodeId;
      } catch (e) {}
    });
  } catch (e) {}
}

function onResize() {
  if (chart) chart.resize();
}

onMounted(() => {
  initChart();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onResize);
  if (chart) {
    try {
      chart.off && chart.off("click");
    } catch (e) {}
    chart.dispose();
    chart = null;
  }
});

watch(
  [
    () => store.nodes,
    () => store.routes,
    () => selected.value,
    () => locale.current.value,
  ],
  () => {
    updateChart();
  },
  { immediate: true, deep: true }
);
</script>

<template>
  <div ref="chartRef" style="height: 100%; width: 100%"></div>
</template>
