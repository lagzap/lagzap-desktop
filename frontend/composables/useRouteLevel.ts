import { useLocale } from "vuetify";

/** Route levels as users see them: how deep a route goes through LagZap's
 * network. 1 Basic, 2 Advanced, 3 Ultimate (Go: coordinator/route_levels.go). */
export const ROUTE_LEVELS = [1, 2, 3] as const;

export function useRouteLevel() {
  const { t } = useLocale();
  const levelName = (level: number) =>
    level >= 1 && level <= 3 ? t(`$vuetify.routeLevel.level${level}`) : "";
  const levelHint = (level: number) =>
    level >= 1 && level <= 3 ? t(`$vuetify.routeLevel.hint${level}`) : "";
  return { levelName, levelHint };
}
