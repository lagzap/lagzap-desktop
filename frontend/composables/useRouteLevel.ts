import { useLocale } from "vuetify";

/** Route levels as users see them: how deep a route goes through LagZap's
 * network. 0 Free (below Basic: no LagZap servers), 1 Basic, 2 Advanced,
 * 3 Ultimate (Go: coordinator/route_levels.go). */
export const ROUTE_LEVELS = [1, 2, 3] as const;

export function useRouteLevel() {
  const { t } = useLocale();
  const levelName = (level: number) =>
    level >= 0 && level <= 3 ? t(`$vuetify.routeLevel.level${level}`) : "";
  const levelHint = (level: number) =>
    level >= 0 && level <= 3 ? t(`$vuetify.routeLevel.hint${level}`) : "";
  /** "Basic routes", or "Free routing" below Basic. */
  const routesText = (level: number) =>
    level === 0 ? t("$vuetify.routeLevel.freeRouting") : t("$vuetify.routeLevel.routes", levelName(level));
  return { levelName, levelHint, routesText };
}
