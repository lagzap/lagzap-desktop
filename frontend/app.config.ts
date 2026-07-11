import type { FetchContext } from "ofetch";
import type { ConsolaInstance } from "consola";
import { defineAppConfig } from "#imports";
import { type NuxtApp } from "#app";
import { saveToken, getToken, removeToken } from "~/utils/indexedDB";

const tokenStorageKey = "lz.access_token";

export default defineAppConfig({
  sanctum: {
    mode: "token",
    interceptors: {
      onRequest: async (
        app: NuxtApp,
        ctx: FetchContext,
        logger: ConsolaInstance
      ) => {
        ctx.options.timeout = 15000;
      },

      onResponse: async (
        app: NuxtApp,
        ctx: FetchContext,
        logger: ConsolaInstance
      ) => {
        //
      },
    },

    tokenStorage: {
      get: async () => {
        return await getToken(tokenStorageKey) ?? undefined;
      },

      set: async (app: NuxtApp, token?: string) => {
        if (!token) {
          await removeToken(tokenStorageKey);
          return;
        }

        await saveToken(tokenStorageKey, token);
      },
    },
  },
});