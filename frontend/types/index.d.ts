declare module "*.vue" {
  import Vue from "vue";
  export default Vue;
}

interface DataResponse {
  user: User
  abilities?: string[]
  active_limit: number
  active_titles: string[]
  recent_titles: Record<string, number>
  active_profiles: Record<string, string[]>
}

interface SessionResponse {
  coordinator: string
  proxy: string
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
  profiles: Profile[]
}

interface Profile {
  id: string
  flags: number
  title_id: string
  rule_id: string
  name: string
  description?: string | null
  process_regex?: string | null
  created_at: string
  updated_at: string
}

interface User {
  id: number
  name: string
  email: string
  phone: number
}
