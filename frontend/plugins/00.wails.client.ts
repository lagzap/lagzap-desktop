// Load Wails v3 runtime first so binding calls use POST /wails/runtime and
// wails:runtime:ready is sent before any page code runs.
import "@wailsio/runtime";

export default defineNuxtPlugin(() => {});
