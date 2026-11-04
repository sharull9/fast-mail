import { defineConfig } from "vite-plus";

// Electron main + preload, bundled to CommonJS for Node. `electron` stays external;
// workspace packages (@mailfast/shared) are inlined.
export default defineConfig({
  pack: {
    entry: { main: "src/main.ts", preload: "src/preload.ts" },
    format: "cjs",
    platform: "node",
    target: "node22",
    outDir: "dist",
    clean: true,
    dts: false,
    fixedExtension: true,
    deps: { neverBundle: ["electron"], alwaysBundle: [/^@mailfast\//] },
  },
});
