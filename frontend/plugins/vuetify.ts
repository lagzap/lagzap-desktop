import "@mdi/font/css/materialdesignicons.css";
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { createVuetify } from "vuetify";
import { en as enVuetify, fa as faVuetify } from 'vuetify/locale'
import { md3 } from "vuetify/blueprints";
import type { DynamicScheme, DynamicColor } from "@material/material-color-utilities";
import { Hct, MaterialDynamicColors, argbFromHex, hexFromArgb, sourceColorFromImage, SchemeNeutral } from "@material/material-color-utilities";
import kebabCase from "just-kebab-case";
import en from "~/i18n/locales/en";
import fa from "~/i18n/locales/fa";

function getDynamicColors(scheme: DynamicScheme) {
  const tokens = Object.keys(
    MaterialDynamicColors
  ) as (keyof typeof MaterialDynamicColors)[];
  return Object.fromEntries(
    tokens
      .map((token) => {
        const key = kebabCase(token);
        const value = MaterialDynamicColors[token] as DynamicColor;
        if (!value.getArgb) return [key, null];
        return [key, hexFromArgb(value.getArgb(scheme))];
      })
      .filter(([, value]) => value !== null)
  );
}

function vuetifyThemeFromColor(
  sourceColor: number,
  dark: boolean,
  contrast = 0.3,
  variables: Record<string, string | number> = {},
  overrideColors: Record<string, string | number> = {}
) {
  const source = Hct.fromInt(sourceColor);
  const scheme = new SchemeNeutral(source, dark, contrast);
  const colors = { ...getDynamicColors(scheme), ...overrideColors };
  return {
    dark,
    colors,
    variables,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function vuetifyThemeFromHex(
  hex: string,
  dark: boolean,
  contrast = 0.3,
  variables: Record<string, string | number> = {}
) {
  return vuetifyThemeFromColor(argbFromHex(hex), dark, contrast, variables);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function vuetifyThemeFromImage(
  image: HTMLImageElement,
  dark: boolean,
  contrast = 0.3,
  variables: Record<string, string | number> = {}
) {
  const color = await sourceColorFromImage(image);
  return vuetifyThemeFromColor(color, dark, contrast, variables);
}

// const primaryColor = 0xFFAB00;

/** Semantic status colors — applied after createVuetify so MD3 defaults cannot win. */
const statusColors = {
  dark: {
    warning: "#FFEB3B",
    error: "#F44336",
    info: "#00BCD4",
    success: "#81C784",
    // Palette names used as colors (latency, plan chips): theme colors here
    // so light gets readable shades; dark keeps Material's.
    amber: "#FFC107",
    lime: "#CDDC39",
    "light-green": "#8BC34A",
    "deep-orange": "#FF5722",
  },
  // Light: deeper shades of the same hues, so status text stays readable on
  // the light grey frame (the 400-level tints were near-invisible there).
  light: {
    warning: "#B45309",
    error: "#C62828",
    info: "#00838F",
    success: "#2E7D32",
    amber: "#B7791F",
    lime: "#6B7D0F",
    "light-green": "#558B2F",
    "deep-orange": "#D84315",
  },
} as const;

export default defineNuxtPlugin({
  name: "vuetify",
  async setup(app) {
  const primaryColor = false ? 0xFFAB00 : 0xe6d785;
  const vuetify = createVuetify({
    components,
    directives,
    blueprint: md3,
    display: {
      mobileBreakpoint: 'md'
    },
    locale: {
      locale: "en",
      fallback: "en",
      messages: {
        en: { ...en, ...enVuetify },
        fa: { ...fa, ...faVuetify },
      },
      rtl: {
        fa: true,
      },
    },
    defaults: {
      global: {
        ripple: true,
      },
      // Chips are pills everywhere (md3 makes them nearly square).
      VChip: {
        rounded: "pill",
      },
    },
    theme: {
      // Default dark for SSR/prerender; client settings plugin syncs from System/prefs.
      defaultTheme: "dark",
      themes: {
        dark: vuetifyThemeFromColor(
          primaryColor,
          true,
          0.4,
          {},
          {
            primary: false ? '#ffc107' : '#e6d785',
            background: "#121212",
            ...statusColors.dark,
          }
        ),
        light: vuetifyThemeFromColor(
          primaryColor,
          false,
          0.9,
          {
            // Full opacity so #171717 reads as ~90% black, not washed grey
            "high-emphasis-opacity": 1,
            "medium-emphasis-opacity": 0.62,
          },
          {
            // Richer gold — more chroma than the muted olive
            primary: false ? '#ffc107' : '#B8860B',
            // Neutral light frame — readable contrast vs white content
            background: "#F0F1F3",
            "on-background": "#171717",
            surface: "#FFFFFF",
            "on-surface": "#171717",
            "on-surface-variant": "#3A3A3A",
            accent: "#2E2E2E",
            ...statusColors.light,
          }
        ),
      },
    },
  });

  // Force status roles onto the live theme (MD3/dynamic palette otherwise leaves
  // Vuetify defaults — e.g. warning #FB8C00 orange).
  for (const name of ["dark", "light"] as const) {
    const theme = vuetify.theme.themes.value[name];
    if (theme?.colors) {
      Object.assign(theme.colors, statusColors[name]);
    }
  }

  app.vueApp.use(vuetify);
  // Plugins that run before any component (settings) apply locale and theme
  // through this; useLocale()/useTheme() need a component.
  app.provide("vuetifyInstance", vuetify);
  },
});
