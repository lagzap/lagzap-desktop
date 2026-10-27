import { adminToolsAvailable } from "~/composables/useAdminToolsWindow";

function isAdminToolsRoute(path: string): boolean {
  return path.startsWith("/admin");
}

/** Channel gate only — Admin Tools is unauthenticated. */
export default defineNuxtRouteMiddleware(async (to) => {
  if (!isAdminToolsRoute(to.path)) {
    return;
  }
  if (!(await adminToolsAvailable())) {
    return navigateTo({ name: "index" });
  }
});
