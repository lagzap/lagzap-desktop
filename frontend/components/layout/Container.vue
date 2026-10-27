<script lang="ts" setup>
import { useDisplay, useLocale } from "vuetify";
import { useFuzzySearch } from "~/composables/useFuzzySearch";

const props = withDefaults(
  defineProps<{
    /** Edge-to-edge content: no rounded card / outer margin */
    flush?: boolean;
  }>(),
  { flush: false },
);

const locale = useLocale();
const { t } = locale
const store = useStore();
const router = useRouter();
const route = useRoute();
const { mobile, height } = useDisplay();
const sidebar = inject<Ref<boolean>>("sidebar");

const titles = computed(() => Object.values(store.titles))
const searchMode = ref(false);

// Use fuzzy search composable
const { searchQuery, searchResults, handleSearch } = useFuzzySearch(titles, store);

onMounted(() => {
  window.addEventListener("keydown", (event) => {
    // Use code for language-independent hotkeys
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyF") {
      event.preventDefault();
      searchMode.value = true;
    } else if (event.code === "Slash") {
      event.preventDefault();
      searchMode.value = true;
    }
  });
});
</script>

<template>
  <v-main>
    <v-app-bar
      absolute
      location="top"
      density="compact"
      color="background"
      :style="{
        position: 'fixed',
        '--wails-draggable': 'drag',
        [$vuetify.locale.isRtl ? 'padding-left' : 'padding-right']: mobile ? '108px' : '144px',
      }"
    >
      <v-scroll-y-transition leave-absolute>
        <div v-if="!searchMode" class="v-toolbar__content">
          <v-app-bar-nav-icon @click="sidebar = !sidebar" />
          <slot name="header" />

          <slot name="toolbar" />

          <v-btn
            icon="mdi-magnify"
            :density="mobile ? 'comfortable' : 'default'"
            @click="searchMode = true"
          />
          <v-btn
            v-if="false"
            icon="mdi-chat-question"
          />
        </div>
        <div v-else class="v-toolbar__content">
          <v-btn :icon="locale.isRtl.value ? 'mdi-arrow-right' : 'mdi-arrow-left'" @click="searchMode = false" />
          <v-autocomplete
            v-model="searchQuery"
            autofocus
            variant="plain"
            density="compact"
            :placeholder="t('$vuetify.common.searchPlaceholder')"
            hide-details
            single-line
            clearable
            menu-icon=""
            :items="searchResults"
            item-title="localizedName"
            item-value="id"
            class="mx-4 auto-complete-style-fix"
            :filter="() => true"
            :custom-filter="() => true"
            @keyup.escape="searchMode = false"
            @update:model-value="(item) => router.push({ name: 'title-id', params: { id: item } })"
            @update:search="(value) => handleSearch(value || '')"
          >
            <template v-slot:item="{ props, item }">
              <v-list-item
                v-bind="props"
                :prepend-avatar="item.raw.icon_url"
                :title="item.raw.localizedName"
              >
                <template #append>
                  <v-tooltip :text="store.isTitleActive(item.raw.id) ? (store.ndisRunning ? 'Active' : 'Service is not running') : 'Inactive'">
                    <template v-slot:activator="{ props }">
                      <v-btn
                        v-bind="props"
                        :color="store.isTitleActive(item.raw.id) ? 'green' : 'secondary'"
                        :icon="store.ndisRunning ? 'mdi-circle-medium' : 'mdi-circle-small'"
                        variant="text"
                        size="md"
                        @click.stop.prevent="store.toggleTitleState(item.raw)"
                      />
                    </template>
                  </v-tooltip>
                </template>
              </v-list-item>
            </template>
          </v-autocomplete>
        </div>
      </v-scroll-y-transition>
    </v-app-bar>

    <v-card
      :rounded="props.flush ? 0 : 'xl'"
      class="v-card--topborder zoom-in"
      :class="props.flush ? 'container-flush' : 'me-2 mb-2'"
      :height="height - 56"
      :style="props.flush ? { margin: 0, borderRadius: 0 } : undefined"
    >
      <template v-if="!!$slots.title" #title>
        <slot name="title" />
      </template>
      <template v-if="!!$slots.subtitle" #subtitle>
        <slot name="subtitle" />
      </template>
      <template v-if="!!$slots.actions" #actions>
        <slot name="actions" />
      </template>

      <div
        class="h-100"
        :class="props.flush ? 'overflow-hidden' : 'overflow-y-auto'"
      >
        <slot />
      </div>
    </v-card>

    <slot name="outside" />
  </v-main>
</template>

<style>
.auto-complete-style-fix {
  .v-field__input {
    padding-top: 0;
  }
}

.container-flush {
  margin: 0 !important;
  border-radius: 0 !important;
}
</style>
