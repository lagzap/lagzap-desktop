<script setup lang="ts">
/**
 * Legacy Help Center route — open the tickets popup instead.
 */
const tickets = useTicketsStore();
const router = useRouter();

onMounted(() => {
  tickets.openTicketsPopup();
  void router.replace({ name: "index" });
});
</script>

<template>
  <div />
</template>
