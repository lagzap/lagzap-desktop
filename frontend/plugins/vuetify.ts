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
import {System} from "@wailsio/runtime";

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

const primaryColor = 0xFFAB00;

export default defineNuxtPlugin(async (app) => {
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
      }
    },
    theme: {
      defaultTheme: await System.IsDarkMode() ? "dark" : "light",
      themes: {
        dark: vuetifyThemeFromColor(
          primaryColor,
          true,
          0.3,
          {},
          {
            background: "#0a0905",
            accent: '#fff'
          }
        ),
        light: vuetifyThemeFromColor(
          primaryColor,
          false,
          0.9,
          {},
          {
            background: "#fff8f4"
          }
        ),
      },
    },
  });
  app.vueApp.use(vuetify);
});
