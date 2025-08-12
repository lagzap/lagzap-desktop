declare module "*.vue" {
  import Vue from "vue";
  export default Vue;
}

interface DataResponse {
  user: User
  endpoint: string
  log_level: string
  dns_server: string
  abilities?: string[]
}

interface SessionResponse {
  coordinator: string
  proxy: string
}

interface User {
  id: number
  name: string
  email: string
  phone: number
}
