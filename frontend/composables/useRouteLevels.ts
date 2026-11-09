import { onBeforeUnmount, onMounted, ref } from "vue";
import { GetRouteLevels } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { RouteLevel } from "~/bindings/github.com/lagzap/lagzap/adapter/models";

// The plan's route level and the biggest gain a higher level measured,
// shared by every view that shows it; refreshed while one is on screen.

const REFRESH_MS = 30_000;
const levels = ref<RouteLevel | null>(null);
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  try {
    levels.value = (await GetRouteLevels()) ?? null;
  } catch {
    // service not running yet
  }
}

export function useRouteLevels() {
  onMounted(() => {
    users++;
    if (users === 1) {
      void refresh();
      timer = setInterval(() => void refresh(), REFRESH_MS);
    }
  });
  onBeforeUnmount(() => {
    users--;
    if (users === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  });
  return { levels, refresh };
}
