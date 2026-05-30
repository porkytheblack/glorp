import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const STATION = process.env.STATION_URL ?? "http://127.0.0.1:4271";

// The dashboard is served as static files by Station at `/`, so use relative
// asset URLs and emit into the package's dist/dashboard. In dev, proxy the
// API + WebSocket to a running Station so there are no CORS hoops.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  build: { outDir: "../dist/dashboard", emptyOutDir: true },
  server: {
    proxy: {
      "/sessions": { target: STATION, ws: true, changeOrigin: true },
      "/health": STATION,
      "/models": STATION,
      "/templates": STATION,
    },
  },
});
