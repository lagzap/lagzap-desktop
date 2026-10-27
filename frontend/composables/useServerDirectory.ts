import { Events } from "@wailsio/runtime";
import { useLocale } from "vuetify";
import { GetServerDirectory } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import type { ServerDirectory } from "~/bindings/github.com/lagzap/lagzap/adapter";

const REFRESH_MS = 5000;
const DEBOUNCE_MS = 300;

/** LagZap servers list. Go builds, measures, labels and sorts everything;
 * this only fetches the snapshot when probe data changes and while visible. */
export function useServerDirectory() {
  const { current } = useLocale();
  const directory = shallowRef<ServerDirectory | null>(null);
  const iface = ref(""); // "" = best connection
  let timer: ReturnType<typeof setInterval> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let offEvents: (() => void)[] = [];

  async function refresh() {
    if (document.hidden) return;
    try {
      directory.value = await GetServerDirectory(iface.value, current.value);
    } catch {
      // service not running yet
    }
  }

  function refreshSoon() {
    clearTimeout(debounce);
    debounce = setTimeout(refresh, DEBOUNCE_MS);
  }

  watch([iface, current], refresh);

  onMounted(() => {
    refresh();
    timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refreshSoon);
    offEvents = ["iface-entry-rtt", "relay-routes", "interfaces-updated", "service-started"].map(
      (event) => Events.On(event, refreshSoon)
    );
  });
  onUnmounted(() => {
    clearInterval(timer);
    clearTimeout(debounce);
    document.removeEventListener("visibilitychange", refreshSoon);
    offEvents.forEach((off) => off());
  });

  return { directory, iface, refresh };
}
