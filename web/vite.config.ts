import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  root: ".",
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:5080",
      "/health": "http://localhost:5080",
    },
  },
  resolve: {
    alias: {
      "@api": "/src/api",
      "@store": "/src/store",
      "@canvas": "/src/canvas",
      "@ui": "/src/ui",
    },
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      manifest: false, // served from public/manifest.webmanifest
      injectRegister: "auto",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,webmanifest}"],
        navigateFallback: "/offline.html",
        navigateFallbackDenylist: [/^\/api\//],

        runtimeCaching: [
          // viewport + event detail: NetworkFirst, short TTL
          {
            urlPattern: /^https?:\/\/[^/]+\/api\/timelines\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-timelines",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 5 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // bible text: StaleWhileRevalidate (content never changes)
          {
            urlPattern: /^https?:\/\/[^/]+\/api\/bible\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "api-bible",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // search: NetworkFirst, no long cache
          {
            urlPattern: /^https?:\/\/[^/]+\/api\/search/,
            handler: "NetworkFirst",
            options: {
              cacheName: "api-search",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
