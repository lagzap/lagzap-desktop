import Fuse from 'fuse.js'
import { computed, ref } from 'vue'
import type { Title } from '~/bindings/github.com/lagzap/zap/data'

export interface SearchableTitle extends Title {
  localizedName: string
  allNames: string
}

export function useFuzzySearch(titles: Ref<Title[]>, store: any) {
  const searchQuery = ref('')
  
  // Transform titles to searchable format with localized names
  const searchableTitles = computed((): SearchableTitle[] => {
    return titles.value.map(title => {
      const localizedName = store.localized(title.name)
      // Get all language versions as separate searchable strings
      const allNames = Object.values(title.name || {}).join(' ')
      
      return {
        ...title,
        localizedName: localizedName,
        allNames: allNames
      }
    })
  })

  // Create Fuse instance with configuration
  const fuse = computed(() => new Fuse(searchableTitles.value, {
    keys: [
      {
        name: 'localizedName',
        weight: 0.4
      },
      {
        name: 'allNames',
        weight: 0.3
      },
      {
        name: 'alias_name',
        weight: 0.3
      }
    ],
    threshold: 0.4, // Fuzzy matching threshold
    includeScore: true,
    includeMatches: true,
    minMatchCharLength: 1,
    shouldSort: true,
    findAllMatches: true,
    ignoreLocation: true,
    useExtendedSearch: false,
    isCaseSensitive: false,
    // Enable fuzzy matching for typos
    distance: 100
  }))

  // Perform fuzzy search using Fuse.js
  const searchResults = computed(() => {
    if (!searchQuery.value.trim()) {
      return searchableTitles.value
    }
    
    const results = fuse.value.search(searchQuery.value)
    return results.map(result => result.item)
  })

  return {
    searchQuery,
    searchResults,
    // Add method to handle search input
    handleSearch: (value: string) => {
      searchQuery.value = value
    }
  }
}
