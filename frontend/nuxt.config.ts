import { transformAssetUrls } from 'vite-plugin-vuetify'

export default defineNuxtConfig({
  ssr: false,
  devtools: { enabled: false },

  app: {
    pageTransition: {
      name: "page",
      mode: "out-in",
    },
    layoutTransition: {
      name: "layout",
      mode: "out-in",
    },
  },

  css: [
    "~/assets/fonts/style.css",
    "~/assets/config.scss",
    "~/assets/scss/vuetify.scss",
    "~/assets/scss/style.scss",
  ],

  build: {
    transpile: ["vuetify"],
  },

  modules: [
    "@nuxt/eslint",
    "@pinia/nuxt",
    "nuxt-auth-sanctum",
    "@vee-validate/nuxt",
  ],


  nitro: {
    preset: 'static'
  },

  sanctum: {
    mode: "token",
    userStateKey: 'lagzap.user.identity',
    baseUrl: 'http://127.0.0.100:9639',
    redirectIfAuthenticated: true,
    redirectIfUnauthenticated: true,
    endpoints: {
      login: "/token",
      logout: "/token/revoke",
      user: `/data`,
    },
    client: {
      retry: -1,
      initialRequest: true,
    },
    redirect: {
      keepRequestedRoute: false,
      onLogin: "/start-service",
      onLogout: "/auth",
      onAuthOnly: '/auth',
      onGuestOnly: '/auth',
    },
    globalMiddleware: {
      enabled: true,
      allow404WithoutAuth: true,
    },
    logLevel: 3,
  },

  typescript: {
    typeCheck: true,
    strict: false,
  },

  eslint: {
    //
  },

  vite: {
    build: {
      // Disable minification
      terserOptions: {
        compress: false,
        mangle: false,
        keep_classnames: true,
        keep_fnames: true
      },
      minify: false
    },
    vue: {
      template: {
        transformAssetUrls,
      },
    },
  },

  compatibilityDate: "2024-07-25",
});