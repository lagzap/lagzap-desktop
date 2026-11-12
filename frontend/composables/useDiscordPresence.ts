import { computed, onBeforeUnmount, watch } from "vue";
import { useLocale } from "vuetify";
import { SetDiscordPresence } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { DiscordPresence } from "~/bindings/github.com/lagzap/lagzap-desktop/models";
import { useStore } from "@/stores";
import { useMonitoringStore } from "~/stores/monitoring";
import { useSettings } from "~/composables/useSettings";
import { localDigits } from "~/utils/localeFormat";

// The user's Discord status: the game LagZap is optimizing, its server city
// and ping. Go keeps the Discord connection (discord_presence.go); this picks
// what to show. Never anything personal: no IP, email or phone.

/** Gaming Traffic profiles: the game itself, not its launcher or updates. */
const PROFILE_GAME_PACKET = 8;
/** A game that just went quiet (loading, a lobby swap) keeps its status this long. */
const GAME_GRACE_MS = 60_000;
const SEND_DELAY_MS = 1000;

export function useDiscordPresence() {
  const store = useStore();
  const { connections } = useMonitoringStore();
  const { settings } = useSettings();
  const { t, current } = useLocale();

  const gameProfiles = computed(
    () => new Set(store.profiles.filter((p) => ((p.flags ?? 0) & PROFILE_GAME_PACKET) !== 0).map((p) => p.id)),
  );

  /** The game being played now: the relayed game traffic with the most data
   * moving, and its busiest connection. */
  const live = computed(() => {
    const byTitle = new Map<string, { speed: number; count: number; busiest: (typeof connections.value)[number] }>();
    for (const c of connections.value ?? []) {
      if (!c.title_id || !c.node_id || !c.profile_id || !gameProfiles.value.has(c.profile_id)) continue;
      const speed = (c.download_speed ?? 0) + (c.upload_speed ?? 0);
      const entry = byTitle.get(c.title_id);
      if (!entry) {
        byTitle.set(c.title_id, { speed, count: 1, busiest: c });
        continue;
      }
      entry.speed += speed;
      entry.count++;
      const busiestSpeed = (entry.busiest.download_speed ?? 0) + (entry.busiest.upload_speed ?? 0);
      if (speed > busiestSpeed) entry.busiest = c;
    }
    let best: { titleId: string; speed: number; count: number; busiest: (typeof connections.value)[number] } | null = null;
    for (const [titleId, entry] of byTitle) {
      if (!best || entry.speed > best.speed || (entry.speed === best.speed && entry.count > best.count)) {
        best = { titleId, ...entry };
      }
    }
    return best;
  });

  // The game keeps its timer while it stays the game, through short gaps.
  let session: { titleId: string; startMs: number; lastSeen: number } | null = null;
  const currentGame = () => {
    const now = Date.now();
    const game = live.value;
    if (game) {
      if (session?.titleId !== game.titleId) {
        session = { titleId: game.titleId, startMs: now, lastSeen: now };
      }
      session.lastSeen = now;
    } else if (session && now - session.lastSeen > GAME_GRACE_MS) {
      session = null;
    }
    return session;
  };

  const cityOf = (nodeId: string | null | undefined) => {
    const node = nodeId ? store.nodes[nodeId] : undefined;
    const city = node?.city as Record<string, string> | undefined;
    return city?.[current.value] || city?.en || node?.name || "";
  };

  let lastGameState = "";
  const build = (): DiscordPresence | null => {
    if (settings.value.discordPresence === false || !store.connected) return null;
    const button = t("$vuetify.discord.getLagZap");
    const serverButton = t("$vuetify.discord.joinServer");
    const game = currentGame();
    const title = game ? store.titles.find((x) => x.id === game.titleId) : undefined;
    if (!game || !title) {
      return new DiscordPresence({ details: t("$vuetify.discord.ready"), buttonLabel: button, serverButtonLabel: serverButton });
    }
    const name = store.titleName(title.name);
    const busiest = live.value?.titleId === game.titleId ? live.value.busiest : null;
    if (busiest) {
      const city = cityOf(busiest.node_id);
      const ping = Math.round(busiest.avg_latency ?? 0);
      const parts = [city, ping > 0 ? t("$vuetify.discord.ping", localDigits(ping)) : ""].filter(Boolean);
      lastGameState = parts.join(" · ");
    }
    return new DiscordPresence({
      details: name,
      state: lastGameState,
      gameIconUrl: title.icon_url ?? "",
      gameName: name,
      startMs: game.startMs,
      buttonLabel: button,
      serverButtonLabel: serverButton,
    });
  };

  // Ping moves every second; Discord takes an update every few seconds and
  // Go drops repeats, so a short delay is enough here.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      SetDiscordPresence(build()).catch((e) => console.error("discord presence", e));
    }, SEND_DELAY_MS);
  };
  watch([live, () => settings.value.discordPresence, () => store.connected, current], send, { immediate: true });
  // The grace period ends without a change to watch.
  const tick = setInterval(send, GAME_GRACE_MS / 2);

  onBeforeUnmount(() => {
    clearTimeout(timer);
    clearInterval(tick);
  });
}
