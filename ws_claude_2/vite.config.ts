import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone prototype. When the FastAPI backend exists, point `/api` at it
// here (e.g. proxy to http://127.0.0.1:8000) and flip the client in queries.ts.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
