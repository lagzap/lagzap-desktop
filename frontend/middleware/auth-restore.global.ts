import { getToken } from "~/utils/indexedDB";
import { clearAuthSession } from "~/composables/useAuthSession";

const tokenStorageKey = "lz.access_token";

export default defineNuxtRouteMiddleware(async (to) => {
  // Auth restore runs before ReloadService on /start-service; defer until startup flow runs.
  if (to.path.startsWith("/start-service") || to.path.startsWith("/auth")) {
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
