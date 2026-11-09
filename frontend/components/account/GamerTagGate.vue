<script setup lang="ts">
import { computed } from "vue";
import GamerTagDialog from "~/components/account/GamerTagDialog.vue";

/** Every account needs a gamer tag: once startup has finished, an account
 * without one gets the dialog, and it stays until one is saved. This covers
 * a new registration and older accounts alike. */
const store = useStore();
const user = useSanctumUser<DataResponse>();

const missing = computed(() => store.appReady && !!user.value?.user && !(user.value.user.name ?? "").trim());
</script>

<template>
  <GamerTagDialog :model-value="missing" required />
</template>
