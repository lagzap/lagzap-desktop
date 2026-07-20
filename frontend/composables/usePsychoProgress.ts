import {
  creepRatePerSec,
  progressFloor,
} from "~/utils/psychoProgress";

/**
 * Feel-good optimize progress: always inches toward 99 until real done.
 * Real updates raise the floor; never sits still waiting on the next event.
 */
export function usePsychoProgress(
  realPct: Ref<number> | ComputedRef<number>,
  active: Ref<boolean> | ComputedRef<boolean>
) {
  const displayPct = ref(0);
  let startedAt = 0;
  let peak = 0;
  let lastTs = 0;
  let raf = 0;

  function stop() {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    lastTs = 0;
  }

  function tick(ts: number) {
    if (!active.value) {
      raf = 0;
      lastTs = 0;
      return;
    }

    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 1 / 60;
    lastTs = ts;

    const real = realPct.value;
    if (real >= 100) {
      peak = 100;
      displayPct.value = 100;
      raf = requestAnimationFrame(tick);
      return;
    }

    const floor = progressFloor(real, performance.now() - startedAt);
    peak = Math.max(peak, floor);
    peak = Math.min(99, peak + creepRatePerSec(peak) * dt);
    displayPct.value = peak;

    raf = requestAnimationFrame(tick);
  }

  watch(
    active,
    (on) => {
      stop();
      if (on) {
        startedAt = performance.now();
        peak = 0;
        displayPct.value = 0;
        raf = requestAnimationFrame(tick);
      } else {
        displayPct.value = 0;
        peak = 0;
      }
    },
    { immediate: true }
  );

  onUnmounted(stop);

  return displayPct;
}
