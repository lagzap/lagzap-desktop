declare module "*.vue" {
  import Vue from "vue";
  export default Vue;
}

interface DataResponse {
  user: Subscriber
  log_level: string
  dns_servers: string[]
  abilities?: string[]
  client: ClientInfo
  /** The team the user is in; absent when not in one. */
  team?: import("~/bindings/github.com/lagzap/lagzap/adapter/models").Team | null
  /** Invitations addressed to the user. */
  team_invites?: import("~/bindings/github.com/lagzap/lagzap/adapter/models").TeamInvite[]
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
