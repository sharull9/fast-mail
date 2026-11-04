import { defineConfig } from "vite-plus";

// Generated files are owned by their tools (TanStack Router, Drizzle Kit, Better Auth CLI).
const generated = [
  "**/routeTree.gen.ts",
  "packages/db/migrations/**",
  "packages/db/src/auth-schema.ts",
  "**/dist/**",
  "**/release/**",
];

export default defineConfig({
  fmt: {
    ignorePatterns: generated,
    printWidth: 120,
  },
  lint: {
    ignorePatterns: generated,
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
});
