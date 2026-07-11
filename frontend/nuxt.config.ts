import { transformAssetUrls } from 'vite-plugin-vuetify'

const vitePort = process.env.WAILS_VITE_PORT || "9245";
const localProxyTarget = "http://127.0.0.100:9639";

// Pre-bundle at dev startup so lazy route imports don't trigger full reloads.
const optimizeDepsInclude = [
  "@material/material-color-utilities",
  "@vee-validate/zod",
  "@vee-validate/yup",
  "@vueuse/core",
  "@wailsio/runtime",
  "country-list-js",
  "echarts",
  "es-toolkit",
  "es-toolkit/compat",
  "fuse.js",
  "just-kebab-case",
  "nuxt-auth-sanctum",
  "pinia",
  "vee-validate",
  "vue-country-flag-next",
  "vuetify",
  "zod",
];

export default defineNuxtConfig({
  ssr: false,
  devtools: { enabled: false },

  components: [
    {
      path: "~/components",
      pathPrefix: false,
      ignore: ["auth", "dialog"],
    },
    {
      path: "~/components/auth",
      prefix: "Auth",
    },
    {
      path: "~/components/dialog",
      prefix: "Dialog",
    },
  ],

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

  devServer: {
    port: 9245,
    // Wails dev proxy dials tcp4 → 127.0.0.1; "localhost" on Windows often binds [::1] only.
    host: "127.0.0.1",
  },

  sanctum: {
    mode: "token",
    userStateKey: 'lagzap.user.identity',
    baseUrl: localProxyTarget,
    redirectIfAuthenticated: true,
    redirectIfUnauthenticated: true,
    endpoints: {
      login: "/token",
      logout: "/token/revoke",
      user: `/data`,
    },
    client: {
      retry: 2,
      initialRequest: false,
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
    optimizeDeps: {
      include: optimizeDepsInclude,
      // Scan app sources up front so page-only imports are discovered before first load.
      entries: [
        "components/**/*.{vue,ts,js}",
        "pages/**/*.{vue,ts,js}",
        "composables/**/*.{ts,js}",
        "layouts/**/*.{vue,ts,js}",
        "plugins/**/*.{ts,js}",
        "stores/**/*.{ts,js}",
      ],
      holdUntilCrawlEnd: true,
    },
    server: {
      strictPort: true,
      // Wails dev proxy forwards to 127.0.0.1; page origin is http://wails.localhost:<port>.
      allowedHosts: ["wails.localhost", "localhost", "127.0.0.1"],
      cors: {
        origin: [
          `http://wails.localhost:${vitePort}`,
          `http://localhost:${vitePort}`,
          `http://127.0.0.1:${vitePort}`,
        ],
        credentials: true,
      },
    },
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