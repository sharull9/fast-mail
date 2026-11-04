import { defineConfig } from "vite-plus";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

// The Bun sidecar owns the API. In dev, Electron starts it on a fixed port and
// Vite proxies /api to it, so the renderer always uses same-origin `/api`.
const apiPort = process.env.MAILFAST_PORT ?? "47821";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: {
    port: 5199,
    strictPort: true,
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
  plugins: [
    // SPA mode: build a static shell the Bun server serves in production.
    tanstackStart({ spa: { enabled: true } }),
    viteReact(),
  ],
});
