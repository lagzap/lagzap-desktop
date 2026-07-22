import { clearAuthSession, redirectToAuth } from "~/composables/useAuthSession";
import { isAuthHttpStatus, isForceUpdateError } from "~/utils/httpError";

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook("sanctum:login", () => {
    console.log("Sanctum login hook triggered", nuxtApp);
  });
  nuxtApp.hook("sanctum:logout", async () => {
    const store = useStore();
    if (store.ndisRunning) {
      store.stopProxy();
    }
    if (store.serviceReady) {
      // await store.disconnect();
    }
  });
  nuxtApp.hook("sanctum:refresh", async () => {
    console.log("Sanctum refresh hook triggered", nuxtApp);
  });
  nuxtApp.hook("sanctum:redirect", (url) => {
    console.log("Sanctum redirect hook triggered", url, nuxtApp);
  });
  nuxtApp.hook("sanctum:error:request", (context) => {
    console.log("Sanctum request error hook triggered", context, nuxtApp);
  });
  nuxtApp.hook("sanctum:error", async (response) => {
    const status = response?.status;
    if (!isAuthHttpStatus(status)) {
      return;
    }

    const payload = response?._data as { message?: string } | undefined;
    if (isForceUpdateError(payload?.message ?? response)) {
      return;
    }

    await clearAuthSession();

    const options = useSanctumConfig();
    if (
      import.meta.client
      && options.redirectIfUnauthenticated
      && status === 403
    ) {
      await redirectToAuth();
    }
  });
});
