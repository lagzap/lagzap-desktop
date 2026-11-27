import { ref } from "vue";

/** Apps & Games is picking an app to add (from a Favorites or Recent +): the
 * next one clicked is added to Favorites (or, with Favorites full, turned on
 * and put at the top of Recent). Shared state, not a query in the address:
 * changing that redrew the whole page on every start, pick and cancel. */
const picking = ref(false);
/** What the pick is for: Favorites (pinned and turned on), or Active (only
 * turned on; the Connections page's Active +). */
const pickMode = ref<"favorite" | "active">("favorite");

export function useFavoritePick() {
  const router = useRouter();
  /** Starts picking and opens Apps & Games (no reload when already there). */
  // Called straight from @click too, so anything but "active" is Favorites.
  function startPicking(mode?: unknown) {
    pickMode.value = mode === "active" ? "active" : "favorite";
    picking.value = true;
    if (router.currentRoute.value.name !== "titles") void router.push({ name: "titles" });
  }
  function stopPicking() {
    picking.value = false;
  }
  return { picking, pickMode, startPicking, stopPicking };
}
