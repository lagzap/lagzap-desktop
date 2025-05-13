export interface Connection {
  id: string;
  network: string;
  source: string;
  destination: string;
  host: string;
  process: string;
  uplink: number;
  downlink: number;
  uplinkSpeed: number;
  downlinkSpeed: number;
  speed: number;
  start: string;
  chains: string[];
  rule: string;
  geoipCode: string;
  action: string;
}

export interface NodeLatency {
  minLatency: number;
  maxLatency: number;
  avgLatency: number;
  pingList: number[];
  packetLoss: number;
  jitter: number;
}