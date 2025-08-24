import type { RelayRoute } from "~/bindings/github.com/lagzap/lagzap/adapter";

export interface Log {
  time: any;
  type: string;
  payload: string;
}

export interface ProcessInfo {
  ProcessID: number;
  ProcessPath: string;
  PackageName: string;
  User: string;
  UserId: number;
}

export interface PingPoint {
  t: number;
  latency: number;
  ok: boolean;
}

export interface RoutePingSeries {
  index: number;
  label: string;
  points: PingPoint[];
}

export interface Connection {
  id: string;
  group_id: string;
  network: string;
  type: string;
  source_ip: string;
  destination_ip: string;
  source_port: string;
  destination_port: string;
  country_code: string;
  host: string;
  process: string;
  upload: number;
  download: number;
  upload_speed: number;
  download_speed: number;
  start: number;
  end: number;
  rule: string;
  title_id: string | null;
  profile_id: string | null;
  node_id: string | null;
  relay_route: RelayRoute | null;
  ping_packet_sent: number;
  ping_packet_received: number;
  ping_packet_loss: number;
  ping_avg_latency: number;
  ping_min_latency: number;
  ping_max_latency: number;
  ping_jitter: number;
  ping_series: RoutePingSeries[];
}

export interface NodeLatency {
  minLatency: number;
  maxLatency: number;
  avgLatency: number;
  pingList: number[];
  packetLoss: number;
  jitter: number;
}

export enum HopStatus {
  UNKNOWN = 0,
  SUCCESS = 1,
  TIMEOUT = 2,
  ERROR = 3,
}

export interface Hop {
  ip: string;
  status: HopStatus;
  latency: number;
  hop_index: number;
}

export interface NodeRoute {
  hops: Hop[];
  packet_sent: number;
  packet_received: number;
  packet_loss: number;
  avg_latency: number;
  min_latency: number;
  max_latency: number;
  jitter: number;
  score: number;
  tcp_available: boolean;
  udp_available: boolean;
}

export interface HopMetric {
  hop: number;
  ip: string;
  latency: number;
  packet_loss: number;
}

export enum TestType {
  PING = 0,
  HTTP = 1,
  TRACEROUTE = 2,
}

export interface NodeOptimizeResult {
  tag: string;
  target_addr: string;
  routes: NodeRoute[];
  is_testing: boolean;
  last_test: number;
  error_message: string;
}
