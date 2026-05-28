import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Dev: proxy /api to the FastAPI backend (single origin → no CORS, no mixed content).
// Backend runs on 5433 so v2 coexists with the live Flask app on 5432 until cutover.
// PWA is wired here; the real manifest/precache tuning is Phase 9 (kept minimal for now).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: { enabled: false },
      manifest: {
        name: "ctrl-b",
        short_name: "ctrl-b",
        theme_color: "#15171c",
        background_color: "#15171c",
        display: "standalone",
        icons: [{ src: "/logo.png", sizes: "512x512", type: "image/png" }],
      },
      workbox: {
        // Never cache /api responses — they're live state and mutations.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Accept any Host header. Vite (>=5.4) otherwise rejects non-localhost/IP hosts as a
    // DNS-rebinding guard, which blocks reaching the dev server by machine name (e.g.
    // http://corsair:5190) or the Tailscale Serve *.ts.net FQDN. Safe here: tailnet-only,
    // no public bind (AGENTS.md §6 security model).
    allowedHosts: true,
    proxy: { "/api": "http://127.0.0.1:5433" },
  },
});
