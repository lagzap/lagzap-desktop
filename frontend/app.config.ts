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
        const token = await getToken(tokenStorageKey) ?? undefined;
        console.log(token, "token from indexedDB");
        return token;
      },

      set: async (app: NuxtApp, token?: string) => {
        console.log(token, "token to indexedDB");
        if (!token) {
          await removeToken(tokenStorageKey);
          return;
        }

        await saveToken(tokenStorageKey, token);
      },
    },
  },
});