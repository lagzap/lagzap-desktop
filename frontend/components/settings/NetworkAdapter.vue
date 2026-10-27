<script lang="ts" setup>
import { useLocale } from "vuetify";
import type { Interface } from "~/bindings/github.com/lagzap/zap/common/control";
import { useNetworkAdapterSettings } from "~/composables/useNetworkAdapterSettings";
import MultiInternetAdvanced from "~/components/settings/MultiInternetAdvanced.vue";

const { t } = useLocale();
const {
  defaultInterfaceOverride,
  multiInternetAuto,
  multiInternetSelection,
  backupInterfacesAuto,
  backupInterfacesSelection,
  loaded,
  refreshInterfaces,
  defaultInterface,
  interfaces,
} = useNetworkAdapterSettings();

const loading = ref(false);

async function update() {
  loading.value = true;
  await refreshInterfaces();
  loading.value = false;
}

// Multi Internet and backup pools: automatic (every adapter, including ones
// connected later) or a hand-picked list of at least one adapter.
const pools = [
  {
    key: "multi",
    description: "$vuetify.settings.multiInternetDescription",
    label: "$vuetify.settings.multiInternet",
    hint: "$vuetify.settings.multiInternetHint",
    auto: multiInternetAuto,
    selection: multiInternetSelection,
  },
  {
    key: "backup",
    description: "$vuetify.settings.backupInterfacesDescription",
    label: "$vuetify.settings.backupInterfaces",
    hint: "$vuetify.settings.backupInterfacesHint",
    auto: backupInterfacesAuto,
    selection: backupInterfacesSelection,
  },
];

function adapterSubtitle(iface: Interface) {
  const ipv4 = (iface.Addresses ?? []).map(String).find((addr) => !addr.includes(":"));
  const parts = [ipv4?.split("/")[0]];
  if (iface.Name === defaultInterface.value) {
    parts.push(t("$vuetify.settings.adapterDefault"));
  }
  return parts.filter(Boolean).join(" · ");
}

</script>

<template>
  <v-card
    :title="t('$vuetify.settings.networkAdapter')"
    flat
    class="mt-3 bg-transparent"
    max-width="720"
  >
    <v-card-text class="network-adapter-settings">
      <section class="settings-section">
        <v-card-subtitle class="px-0 mb-3 text-wrap">
          {{ t('$vuetify.settings.networkAdapterDescription') }}
        </v-card-subtitle>
        <v-select
          v-model="defaultInterfaceOverride"
          :loading="loading || !loaded"
          :label="t('$vuetify.settings.defaultInterface')"
          :hint="t('$vuetify.settings.defaultInterfaceHint')"
          :items="interfaces"
          item-value="Name"
          item-title="Name"
          density="comfortable"
          variant="outlined"
          :placeholder="
            t('$vuetify.settings.leaveInterfaceEmptyAutomatic', [defaultInterface])
          "
          clearable
          persistent-hint
          @click="update"
        />
      </section>

      <section v-for="pool in pools" :key="pool.key" class="settings-section">
        <v-card-subtitle class="px-0 mb-1 text-wrap">
          {{ t(pool.description) }}
        </v-card-subtitle>
        <v-switch
          v-model="pool.auto.value"
          :label="t('$vuetify.settings.useAllAdapters')"
          color="primary"
          density="compact"
          hide-details
          inset
          class="mb-2"
        />
        <v-select
          v-model="pool.selection.value"
          :loading="loading || !loaded"
          :label="t(pool.label)"
          :hint="t(pool.auto.value ? '$vuetify.settings.useAllAdaptersHint' : pool.hint)"
          :items="interfaces"
          :readonly="pool.auto.value"
          :closable-chips="!pool.auto.value && pool.selection.value.length > 1"
          item-value="Name"
          item-title="Name"
          density="comfortable"
          variant="outlined"
          multiple
          chips
          persistent-hint
          @click="update"
        >
          <template #item="{ props: itemProps, item }">
            <v-list-item v-bind="itemProps" :subtitle="adapterSubtitle(item.raw)">
              <template #prepend="{ isSelected }">
                <v-checkbox-btn :model-value="isSelected" :disabled="isSelected && pool.selection.value.length === 1" />
              </template>
            </v-list-item>
          </template>
        </v-select>
      </section>

      <MultiInternetAdvanced class="settings-section advanced-panels" />
    </v-card-text>
  </v-card>
</template>

<style scoped>
.network-adapter-settings {
  padding-bottom: 0;
}

.settings-section + .settings-section {
  margin-top: 2rem;
}

.advanced-panels {
  margin-top: 2rem;
}

</style>
