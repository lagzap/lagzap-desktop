// clients/desktop/frontend/utils/colors.ts

/**
 * Material Design 3 Color Palette for Light Theme
 * Based on https://m3.material.io/styles/color/the-color-system/color-roles
 */
export const lightThemeColors = {
  primary: "#6750A4",
  surface: "#FFFBFE",
  onSurface: "#1C1B1F",
  success: "#66BB6A",
  warning: "#F9A825",
  error: "#E53935",
  info: "#00ACC1",
  userMarker: "#00639B",
  destinationMarker: "#000",
  mapArea: "#F4F6F8",
  mapBorder: "rgba(0,0,0,0.12)",
  mapEmphasisArea: "rgba(0,0,0,0.05)",
  mapEmphasisBorder: "rgba(0,0,0,0.22)",
};

/**
 * Material Design 3 Color Palette for Dark Theme
 */
export const darkThemeColors = {
  primary: "#D0BCFF",
  surface: "#1C1B1F",
  onSurface: "#E6E1E5",
  success: "#81C784",
  warning: "#FFEB3B",
  error: "#F44336",
  info: "#00BCD4",
  userMarker: "#4FC3F7",
  destinationMarker: "#fff",
  mapArea: "rgba(255,255,255,0.01)",
  mapBorder: "rgba(255,255,255,0.15)",
  mapEmphasisArea: "rgba(255,255,255,0.03)",
  mapEmphasisBorder: "rgba(255,255,255,0.015)",
};

/**
 * Determines if the user's system is in dark mode.
 * @returns {boolean} True if dark mode is enabled, otherwise false.
 */
function isSystemDarkMode(): boolean {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return true; // Default to dark mode if not in a browser environment
}

/**
 * Exports the appropriate color palette based on the system's color scheme.
 */
export const chartColors = isSystemDarkMode()
  ? darkThemeColors
  : lightThemeColors;


