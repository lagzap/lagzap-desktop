declare module "*.vue" {
  import Vue from "vue";
  export default Vue;
}

interface DataResponse {
  regions: Region[]
  nodes: Node[]
  titles: Title[]
  user: User
  abilities?: string[]
  active_limit: number
  active_titles: string[]
  recent_titles: Record<string, number>
}

interface Region {
  tag:    string
	name:   string
	host:   string
	active: bool
}

interface Node {
  id: string
  region: string
  area: string
  name: string
  country: string
  city: string
  latitude: number
  longitude: number
  ipv4: string
  ipv6?: string | null
}

interface Title {
  id: string
  flags: number
  name: string
  icon_url: string | null
  poster_url: string | null
  process_regex: string
}

interface User {
  id: number
  name: string
  email: string
  phone: number
}
