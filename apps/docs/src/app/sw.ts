/// <reference lib="esnext" />
/// <reference lib="webworker" />
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

// `injectionPoint` is replaced by the precache manifest at build time.
declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// The worker is served at `<basePath>/sw.js`, so its own path gives the base path.
const BASE_PATH = new URL(self.location.href).pathname.replace(/\/sw\.js$/, "");

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  // Drops the workbox-precache-* caches left behind by the previous next-pwa worker.
  precacheOptions: { cleanupOutdatedCaches: true },
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
  fallbacks: {
    entries: [
      {
        url: `${BASE_PATH}/~offline`,
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

serwist.addEventListeners();
