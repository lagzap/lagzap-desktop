declare module "*.vue" {
  import Vue from "vue";
  export default Vue;
}

interface DataResponse {
  user: User
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
