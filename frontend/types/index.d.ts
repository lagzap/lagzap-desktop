declare module "*.vue" {
  import Vue from "vue";
  export default Vue;
}

interface DataResponse {
  user: Subscriber
  endpoints: string[]
  log_level: string
  dns_servers: string[]
  abilities?: string[]
  client: ClientInfo
}

interface SessionResponse {
  coordinator: string
  proxy: string
}

interface Subscriber {
  id: string
  name?: string
  email?: string
  phone?: number
  status?: string
  /** Display name of the plan — stub until billing ships. */
  plan_name?: string
  /** e.g. active | trial | expiring | expired — stub until billing ships. */
  plan_status?: string
  /** ISO date string or null for unlimited — stub until billing ships. */
  expires_at?: string | null
}

interface ClientInfo {
  isp: string
  ip: string
  city: string
  region: string
  country: string
  continent: string
  currency: string
  timezone: string
  latitude: number
  longitude: number
  vpn: boolean
}
