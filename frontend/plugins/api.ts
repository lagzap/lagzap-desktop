import { useLocale } from "vuetify";

export default defineNuxtPlugin((nuxtApp) => {
  const api = $fetch.create({
    onRequest({ options }) {
      nuxtApp.runWithContext(() => {
        const { current } = useLocale();

        if (current) {
          const headers = (options.headers);
          if (Array.isArray(headers)) {
            headers.push(["Accept-Language", current.value]);
          } else if (headers instanceof Headers) {
            headers.set("Accept-Language", current.value);
          }
        }
      });
    },
  });

  return {
    provide: {
      api,
    },
  };
});
