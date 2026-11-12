import { computed, type Ref } from 'vue'
import type { Title, TitleCategory } from '~/bindings/github.com/lagzap/zap/data/models'

/** Filter keys that are not category slugs. Slugs are lowercase words with
 * dashes, so these never clash. */
export const CATEGORY_ALL = ''
export const CATEGORY_UNCATEGORIZED = '__uncategorized'

export function titleCategoriesOf(title: Title | null | undefined): TitleCategory[] {
  const list = title?.categories
  if (!Array.isArray(list)) return []
  return list.filter((c): c is TitleCategory => !!c?.id && !!c.slug)
}

function updatedAtMs(title: Title): number {
  const ms = Date.parse(title.updated_at ?? '')
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * Distinct categories across titles, same rule as the library's
 * coordinator.TitleCategories: deduped by id, the copy from the most recently
 * updated title wins (current name and order), sorted by order, then slug.
 * Rebuilt from the titles every time; categories are never cached apart.
 */
export function distinctTitleCategories(titles: Title[]): TitleCategory[] {
  const picks = new Map<string, { category: TitleCategory; at: number; titleId: string }>()
  for (const title of titles) {
    if (!title) continue
    const at = updatedAtMs(title)
    const titleId = title.id ?? ''
    for (const category of titleCategoriesOf(title)) {
      const current = picks.get(category.id!)
      if (current && (at < current.at || (at === current.at && titleId <= current.titleId))) continue
      picks.set(category.id!, { category, at, titleId })
    }
  }
  return [...picks.values()]
    .map((p) => p.category)
    .sort((a, b) => {
      const order = (a.order ?? 0) - (b.order ?? 0)
      if (order !== 0) return order
      const slugA = a.slug ?? ''
      const slugB = b.slug ?? ''
      if (slugA !== slugB) return slugA < slugB ? -1 : 1
      const idA = a.id ?? ''
      const idB = b.id ?? ''
      return idA < idB ? -1 : idA > idB ? 1 : 0
    })
}

/** Icons are keyed on the stable slug, never on the display name. */
const CATEGORY_ICONS: Record<string, string> = {
  'battle-royale': 'mdi-parachute',
  shooter: 'mdi-target',
  fps: 'mdi-target',
  moba: 'mdi-sword-cross',
  mmo: 'mdi-earth',
  mmorpg: 'mdi-earth',
  rpg: 'mdi-sword',
  racing: 'mdi-flag-checkered',
  sports: 'mdi-soccer',
  strategy: 'mdi-chess-knight',
  fighting: 'mdi-boxing-glove',
  survival: 'mdi-campfire',
  sandbox: 'mdi-cube-outline',
  'card-game': 'mdi-cards-playing-outline',
  apps: 'mdi-apps',
  streaming: 'mdi-broadcast',
  voice: 'mdi-microphone',
}

export function titleCategoryIcon(slug: string | undefined): string | undefined {
  return slug ? CATEGORY_ICONS[slug] : undefined
}

export function useTitleCategories(titles: Ref<Title[]>, locale: Ref<string>, englishNames: Ref<boolean>) {
  const categories = computed(() => distinctTitleCategories(titles.value))
  const hasUncategorized = computed(() => titles.value.some((t) => titleCategoriesOf(t).length === 0))

  /** name[currentLocale], then name["en"], then slug: the title-name rule. */
  const categoryName = (category: TitleCategory) => {
    const name = category.name ?? {}
    return (englishNames.value && name.en) || name[locale.value] || name.en || category.slug || ''
  }

  /** Keys the screen can filter by right now, in display order. */
  const filterKeys = computed(() => {
    const keys = [CATEGORY_ALL, ...categories.value.map((c) => c.slug!)]
    if (hasUncategorized.value && categories.value.length > 0) keys.push(CATEGORY_UNCATEGORIZED)
    return keys
  })

  const titleInFilter = (title: Title, key: string) => {
    if (key === CATEGORY_ALL) return true
    const list = titleCategoriesOf(title)
    if (key === CATEGORY_UNCATEGORIZED) return list.length === 0
    return list.some((c) => c.slug === key)
  }

  return { categories, hasUncategorized, categoryName, filterKeys, titleInFilter }
}
