import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  use: { baseURL: "http://localhost:5299", viewport: { width: 1280, height: 800 } },
  webServer: {
    command: "bunx vp dev --port 5299 --strictPort",
    url: "http://localhost:5299",
    reuseExistingServer: !process.env.CI,
  },
});
