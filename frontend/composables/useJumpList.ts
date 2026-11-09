import { computed, onBeforeUnmount, watch } from "vue";
import { useRouter } from "vue-router";
import { useLocale, useTheme } from "vuetify";
import { Events } from "@wailsio/runtime";
import { SetJumpList, TakeJumpListRoute } from "~/bindings/github.com/lagzap/lagzap-desktop/service";
import { useStore } from "@/stores";
import { useFavoriteTitles } from "~/composables/useFavoriteTitles";

// The taskbar Jump List: General, Favorites and the top recent titles. Go
// builds it (jumplist.go); this sends what to show and opens what was clicked.

const RECENT_COUNT = 3;
const ICON_SIZE = 48;
const SEND_DELAY_MS = 1000;
const ICON_FONT = "Material Design Icons";

/** A Material Design icon drawn to a PNG data URL, for the list's .ico files. */
async function glyphIcon(icon: string, color: string): Promise<string> {
  await document.fonts.load(`${ICON_SIZE}px "${ICON_FONT}"`);
  const probe = document.createElement("i");
  probe.className = `mdi ${icon}`;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const glyph = getComputedStyle(probe, "::before").content.replace(/^["']|["']$/g, "");
  probe.remove();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx || !glyph || glyph === "none") {
    return "";
  }
  ctx.font = `${ICON_SIZE * 0.85}px "${ICON_FONT}"`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, ICON_SIZE / 2, ICON_SIZE / 2);
  return canvas.toDataURL("image/png");
}

function jumpRoute(target: string) {
  switch (target) {
    case "overview":
      return { name: "index" };
    case "ping":
      return { name: "monitoring" };
    case "settings":
      return { name: "settings" };
  }
  if (target.startsWith("title:")) {
    return { name: "title-id", params: { id: target.slice("title:".length) } };
  }
  return null;
}

export function useJumpList() {
  const store = useStore();
  const router = useRouter();
  const { t } = useLocale();
  const theme = useTheme();
  const { favoriteTitles, recentTitlesExcludingFavorites } = useFavoriteTitles();

  const toEntry = (title: { id: string; name: Record<string, string>; icon_url?: string | null }) => ({
    id: title.id,
    name: store.titleName(title.name),
    iconUrl: title.icon_url ?? "",
  });

  const labels = computed(() => ({
    general: t("$vuetify.jumpList.general"),
    overview: t("$vuetify.navigation.overview"),
    settings: t("$vuetify.navigation.settings"),
    favorites: t("$vuetify.navigation.favorites"),
    recent: t("$vuetify.navigation.recent"),
    internetPing: t("$vuetify.jumpList.internetPing", "{0}"),
    internetPingNone: t("$vuetify.jumpList.internetPingNone"),
  }));
  const favorites = computed(() => favoriteTitles.value.map(toEntry));
  const recent = computed(() => recentTitlesExcludingFavorites.value.slice(0, RECENT_COUNT).map(toEntry));
  const iconColor = computed(() => theme.current.value.colors.primary);

  const icons: Record<string, string> = {};
  const iconFor = async (icon: string) => {
    const key = `${icon}|${iconColor.value}`;
    icons[key] ??= await glyphIcon(icon, iconColor.value);
    return icons[key];
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await SetJumpList({
          labels: labels.value,
          pingIcon: await iconFor("mdi-speedometer"),
          settingsIcon: await iconFor("mdi-cog"),
          favorites: favorites.value,
          recent: recent.value,
        });
      } catch (e) {
        console.error("jump list", e);
      }
    }, SEND_DELAY_MS);
  };
  watch([labels, favorites, recent, iconColor], send, { deep: true, immediate: true });

  // A clicked entry waits in Go until the app is ready to navigate.
  const open = async () => {
    if (!store.appReady) {
      return;
    }
    const route = jumpRoute(await TakeJumpListRoute());
    if (route) {
      await router.push(route);
    }
  };
  const off = Events.On("jump-list-open", () => void open());
  watch(() => store.appReady, (ready) => ready && void open(), { immediate: true });

  onBeforeUnmount(() => {
    clearTimeout(timer);
    off();
  });
}
