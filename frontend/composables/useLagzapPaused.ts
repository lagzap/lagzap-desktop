/** LagZap paused: the main switch (Home) is off, so nothing goes through
 * LagZap and every app goes direct, whatever its own switch says. Shown on
 * the game page, the sidebar and its strip, with Resume. */
export function useLagzapPaused() {
  const store = useStore();
  // Only once the app knows: while it starts or switches, nothing is said.
  const paused = computed(() => store.appReady && !store.ndisRunning && !store.ndisToggling);
  async function resume() {
    if (store.ndisToggling) return;
    try {
      await store.setNDIS(true);
    } catch (error) {
      console.warn("Resume failed:", error);
    }
  }
  /** On, but nothing goes through LagZap: shown orange, not green. */
  const titlePaused = (titleId: string) => paused.value && store.isTitleActive(titleId);
  return { paused, resume, titlePaused };
}
