<script setup lang="ts">
/**
 * Deep-link / legacy route: open the ticket chat popup and leave the page.
 */
const route = useRoute();
const router = useRouter();
const tickets = useTicketsStore();

onMounted(() => {
  const id = String(route.params.id || "");
  if (id) {
    tickets.openTicketPopup(id);
  } else {
    tickets.openTicketsPopup();
  }
  void router.replace({ name: "index" });
});
</script>

<template>
  <div />
</template>
