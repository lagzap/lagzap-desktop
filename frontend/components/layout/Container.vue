<script lang="ts" setup>
import { useDisplay, useLocale } from "vuetify";

const locale = useLocale();
const { t } = locale
const store = useStore();
const router = useRouter();
const { mobile, height } = useDisplay();
const sidebar = inject<Ref<boolean>>("sidebar");

const titles = computed(() => Object.values(store.titles))
const searchMode = ref(false);

onMounted(() => {
  window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "f") {
      event.preventDefault();
      searchMode.value = true;
    } else if (event.key === "/") {
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
            autofocus
            class="mx-4"
            variant="plain"
            density="compact"
            :placeholder="t('$vuetify.common.searchPlaceholder')"
            hide-details
            single-line
            clearable
            menu-icon=""
            :items="titles"
            item-title="name"
            item-value="id"
            @keyup.escape="searchMode = false"
            @update:model-value="(item) => router.push({ name: 'title-id', params: { id: item } })"
          >
            <template v-slot:item="{ props, item }">
              <v-list-item
                v-bind="props"
                :prepend-avatar="item.raw.icon_url"
                :title="store.localized(item.raw.name)"
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

    <v-card rounded="xl" class="zoom-in me-2 mb-2" :height="height - 56">
      <template v-if="!!$slots.title" #title>
        <slot name="title" />
      </template>
      <template v-if="!!$slots.subtitle" #subtitle>
        <slot name="subtitle" />
      </template>
      <template v-if="!!$slots.actions" #actions>
        <slot name="actions" />
      </template>

      <div class="h-100 overflow-y-auto">
        <slot />
      </div>
    </v-card>

    <slot name="outside" />
  </v-main>
</template>
