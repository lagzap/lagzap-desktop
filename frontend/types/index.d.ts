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
