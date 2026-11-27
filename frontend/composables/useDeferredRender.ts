import { onMounted, ref } from "vue";

/** A heavy page shows at once: the route switches with its frame and
 * placeholders, and its content renders a frame later (rendering it all
 * first held the old page on screen for a few hundred ms). */
export function useDeferredRender() {
  const ready = ref(false);
  onMounted(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => (ready.value = true)));
  });
  return ready;
}
