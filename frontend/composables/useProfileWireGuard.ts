import { computed, ref, type Ref } from "vue";
import { Events } from "@wailsio/runtime";
import {
  CheckWireGuardConfig,
  GetProfileWireGuard,
  GetWireGuardStatus,
  SetProfileWireGuardEnabled,
} from "~/bindings/github.com/lagzap/lagzap-desktop/service";

/** A profile's Dedicated IP (WireGuard), shared by everything showing it:
 * the row in the region menu, the alert under the profile and the route
 * diagram's WireGuard hop. The configs are one list on this PC; the tunnel
 * belongs to a config, shared by the profiles using it. */
export interface WireGuardConfig {
  id: string;
  name: string;
  ip: string;
  port: number;
  country: string;
  city: string;
  addresses: string[];
  profiles: string[];
}
export interface WireGuardSummary {
  enabled: boolean;
  selected: string;
  configs: WireGuardConfig[];
}
export interface WireGuardStatus {
  state: string;
  relay: string;
  /** The tunnel goes straight to the WireGuard server (region: Direct). */
  direct: boolean;
  /** The profile whose region choice picks the relay. */
  owner: string;
  /** The tunnel's LagZap session: connections inside it carry it as their
   * group_id. */
  session: string;
  ping: number;
  handshake: number;
  error: string;
}

interface State {
  summary: Ref<WireGuardSummary>;
  status: Ref<WireGuardStatus>;
}

const states = new Map<string, State>();
/** Configs being checked again by hand, shared by every place showing one. */
const checkingConfigs = ref<Record<string, boolean>>({});
let listening = false;

const OFF: WireGuardStatus = { state: "off", relay: "", direct: false, owner: "", session: "", ping: 0, handshake: 0, error: "" };

function asSummary(data: unknown): WireGuardSummary {
  const value = (data ?? {}) as Partial<WireGuardSummary>;
  return { enabled: !!value.enabled, selected: value.selected ?? "", configs: value.configs ?? [] };
}

function asStatus(data: unknown): (WireGuardStatus & { configId: string }) | null {
  const raw = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Partial<WireGuardStatus> & { config_id?: string };
  return {
    configId: value.config_id ?? "",
    state: value.state ?? "off",
    relay: value.relay ?? "",
    direct: !!value.direct,
    owner: value.owner ?? "",
    session: value.session ?? "",
    ping: value.ping ?? 0,
    handshake: value.handshake ?? 0,
    error: value.error ?? "",
  };
}

async function load(profileId: string) {
  const state = states.get(profileId);
  if (!state) return;
  try {
    state.summary.value = asSummary(await GetProfileWireGuard(profileId));
    const status = asStatus(await GetWireGuardStatus(profileId));
    state.status.value = status ?? { ...OFF };
  } catch {
    // service not running yet; service-started loads again
  }
}

function listen() {
  if (listening) return;
  listening = true;
  Events.On("wireguard-status", ({ data }: any) => {
    const next = asStatus(data);
    if (!next?.configId) return;
    for (const state of states.values()) {
      if (state.summary.value.selected === next.configId) {
        const { configId: _, ...status } = next;
        state.status.value = status;
      }
    }
  });
  // Asked before the service was up, the list came back empty; and a
  // config's dedicated IP and city arrive once its tunnel first works.
  for (const event of ["service-started", "wireguard-configs"]) {
    Events.On(event, () => {
      for (const id of states.keys()) void load(id);
    });
  }
}

export function useProfileWireGuard(profileId: string) {
  listen();
  let state = states.get(profileId);
  if (!state) {
    state = {
      summary: ref<WireGuardSummary>({ enabled: false, selected: "", configs: [] }),
      status: ref<WireGuardStatus>({ ...OFF }),
    };
    states.set(profileId, state);
    void load(profileId);
  }
  const { summary, status } = state;
  const selected = computed(() => summary.value.configs.find((c) => c.id === summary.value.selected) ?? null);
  /** In use now: on, and its tunnel up (the profile is active). */
  const active = computed(() => summary.value.enabled && !!selected.value && status.value.state !== "off");

  /** Its config checked again now (a ping clicked): the tunnel's check runs
   * right away, and the status comes back with it. */
  const checking = computed(() => !!checkingConfigs.value[summary.value.selected]);
  async function checkNow() {
    const id = summary.value.selected;
    if (!id || checkingConfigs.value[id]) return;
    checkingConfigs.value = { ...checkingConfigs.value, [id]: true };
    try {
      await CheckWireGuardConfig(id);
      await load(profileId);
    } catch {
      // service not running
    } finally {
      checkingConfigs.value = { ...checkingConfigs.value, [id]: false };
    }
  }

  async function setEnabled(enabled: boolean) {
    await SetProfileWireGuardEnabled(profileId, enabled);
    await load(profileId);
  }

  return {
    summary,
    status,
    selected,
    active,
    reload: () => load(profileId),
    setEnabled,
    checking,
    checkNow,
  };
}
