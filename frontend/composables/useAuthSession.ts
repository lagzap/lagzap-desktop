export async function clearAuthSession(): Promise<void> {
  const nuxtApp = useNuxtApp();
  const user = useSanctumUser();
  const appConfig = useSanctumAppConfig();

  user.value = null;

  if (appConfig.tokenStorage) {
    await appConfig.tokenStorage.set(nuxtApp, undefined);
  }
}

export async function redirectToAuth(): Promise<void> {
  const nuxtApp = useNuxtApp();
  const options = useSanctumConfig();
  const redirectUrl = typeof options.redirect.onAuthOnly === "string"
    ? options.redirect.onAuthOnly
    : "/auth";

  await nuxtApp.callHook("sanctum:redirect", redirectUrl);
  await nuxtApp.runWithContext(async () => {
    await navigateTo(redirectUrl, { replace: true });
  });
}

export async function handleAuthFailure(): Promise<void> {
  const store = useStore();
  await store.resetToPreStartup();
  await clearAuthSession();
  await redirectToAuth();
}
