import { computed } from "vue";
import type { Node } from "~/bindings/github.com/lagzap/zap/data";

export function formatLocationSuffix(index: number): string {
  const number = index + 1;
  if (number < 100) {
    return String(number).padStart(2, "0");
  }
  return String(number);
}

export function buildNodeLocationLabel(
  city: string,
  index: number,
  totalInCity: number
): string {
  if (totalInCity <= 1) {
    return city;
  }
  return `${city} ${formatLocationSuffix(index)}`;
}

export function nodeCityGroupKey(node: Node): string {
  const city = node.city;
  if (city) {
    return (city.en || Object.values(city)[0] || node.name).toLowerCase();
  }
  return node.name.toLowerCase();
}

export function buildNodeLocationLabelMap(
  nodes: Node[],
  localize: (city: Node["city"]) => string
): Map<string, string> {
  const byCity = new Map<string, Node[]>();

  for (const node of nodes) {
    const key = nodeCityGroupKey(node);
    const list = byCity.get(key) ?? [];
    list.push(node);
    byCity.set(key, list);
  }

  const labelByNodeId = new Map<string, string>();
  for (const cityNodes of byCity.values()) {
    cityNodes.sort((a, b) => a.name.localeCompare(b.name));
    const cityLabel = localize(cityNodes[0].city);
    cityNodes.forEach((node, index) => {
      labelByNodeId.set(
        node.id,
        buildNodeLocationLabel(cityLabel, index, cityNodes.length)
      );
    });
  }

  return labelByNodeId;
}

export function useNodeLocationLabel() {
  const store = useStore();

  const labelByNodeId = computed(() =>
    buildNodeLocationLabelMap(Object.values(store.nodes), (city) =>
      store.localized(city) as string
    )
  );

  const cityGroupMap = computed(() => {
    const map = new Map<string, Node[]>();
    for (const node of Object.values(store.nodes)) {
      const key = nodeCityGroupKey(node);
      const list = map.get(key) ?? [];
      list.push(node);
      map.set(key, list);
    }
    for (const nodes of map.values()) {
      nodes.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  });

  function getLocalizedCityName(node: Node): string {
    return store.localized(node.city) as string;
  }

  function getCityGroupLabel(cityKey: string): string {
    const nodes = cityGroupMap.value.get(cityKey);
    if (!nodes?.length) {
      return cityKey;
    }
    return getLocalizedCityName(nodes[0]);
  }

  function getCityGroupNodes(cityKey: string): Node[] {
    return cityGroupMap.value.get(cityKey) ?? [];
  }

  function cityKeyForNode(nodeOrName: Node | string | null | undefined): string | null {
    if (!nodeOrName) {
      return null;
    }
    const node =
      typeof nodeOrName === "object"
        ? nodeOrName
        : store.nodes[nodeOrName] ??
          Object.values(store.nodes).find((item) => item.name === nodeOrName);
    return node ? nodeCityGroupKey(node) : null;
  }

  const labelByNodeName = computed(() => {
    const map = new Map<string, string>();
    for (const node of Object.values(store.nodes)) {
      const label = labelByNodeId.value.get(node.id);
      if (label) {
        map.set(node.name, label);
      }
    }
    return map;
  });

  const labelByIp = computed(() => {
    const map = new Map<string, string>();
    for (const node of Object.values(store.nodes)) {
      const label = labelByNodeId.value.get(node.id);
      if (!label) {
        continue;
      }
      if (node.ipv4) {
        map.set(node.ipv4, label);
      }
      if (node.ipv6) {
        map.set(node.ipv6, label);
      }
    }
    return map;
  });

  function getNodeLabel(nodeOrId: Node | string | null | undefined): string {
    if (!nodeOrId) {
      return "-";
    }

    if (typeof nodeOrId === "object") {
      return (
        labelByNodeId.value.get(nodeOrId.id) ??
        (store.localized(nodeOrId.city) as string) ??
        nodeOrId.name
      );
    }

    const byId = labelByNodeId.value.get(nodeOrId);
    if (byId) {
      return byId;
    }

    const node = store.nodes[nodeOrId];
    if (node) {
      return (
        labelByNodeId.value.get(node.id) ??
        (store.localized(node.city) as string) ??
        node.name
      );
    }

    return labelByNodeName.value.get(nodeOrId) ?? nodeOrId;
  }

  function getNodeLabelByIp(ip: string | null | undefined): string {
    if (!ip) {
      return "Server";
    }
    return labelByIp.value.get(ip) ?? "Server";
  }

  function getNodeLabelByName(name: string | null | undefined): string {
    if (!name) {
      return "-";
    }
    return getNodeLabel(name);
  }

  return {
    formatLocationSuffix,
    buildNodeLocationLabel,
    labelByNodeId,
    cityGroupMap,
    getLocalizedCityName,
    getCityGroupLabel,
    getCityGroupNodes,
    cityKeyForNode,
    getNodeLabel,
    getNodeLabelByIp,
    getNodeLabelByName,
  };
}
