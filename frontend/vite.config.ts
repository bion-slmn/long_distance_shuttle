import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),

    VitePWA({
      // "prompt" rather than "autoUpdate": a new service worker must not
      // reload the page underneath a clerk who is mid-booking or waiting on
      // an M-Pesa confirmation. PwaUpdatePrompt shows a toast and the user
      // picks when to reload.
      registerType: "prompt",

      includeAssets: ["favicon.svg", "apple-touch-icon.png", "fonts/*.woff2"],

      manifest: {
        id: "/",
        name: "ShuttleHub",
        short_name: "ShuttleHub",
        description:
          "Shuttle and matatu sacco bookings, queues and M-Pesa payments.",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait-primary",
        theme_color: "#15803D",
        background_color: "#ffffff",
        categories: ["travel", "business"],
        icons: [
          { src: "/pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },

      workbox: {
        // Precache everything Vite emits so the app shell opens offline.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        cleanupOutdatedCaches: true,

        // Serve the SPA shell for any navigation (deep links, offline), but
        // never for API routes: booking and payment data must always hit
        // the server, so the service worker stays out of those requests.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
      },

      devOptions: {
        enabled: true,
      },
    }),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
