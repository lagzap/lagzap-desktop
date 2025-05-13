import { useLocale } from "vuetify";

export const __ = (key: string, ...any: any[]) => {
  const { t } = useLocale()
  return t(`$vuetify.${key}`, ...any)
}
