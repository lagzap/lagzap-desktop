import { getToken } from "~/utils/indexedDB";
import { clearAuthSession } from "~/composables/useAuthSession";

const tokenStorageKey = "lz.access_token";

function skipAuthRestore(path: string): boolean {
  return (
    path.startsWith("/start-service") ||
    path.startsWith("/auth") ||
    path.startsWith("/admin") ||
    path.startsWith("/latency-overlay")
  );
}

export default defineNuxtRouteMiddleware(async (to) => {
  // Secondary windows (admin / latency) must never touch the shared token.
  // Auth restore runs before ReloadService on /start-service; defer until startup.
  if (skipAuthRestore(to.path)) {
    return;
  }

  const { isAuthenticated, init } = useSanctumAuth();

  if (isAuthenticated.value) {
    return;
  }

  const token = await getToken(tokenStorageKey);
  if (!token) {
    return;
  }

  try {
    await init();
  } catch {
    await clearAuthSession();
  }
});
