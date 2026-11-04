import { createEnv } from "@t3-oss/env-core";
import { onValidationError, port, DEV_API_PORT, type RuntimeEnv } from "./shared.ts";

/**
 * Environment read by apps/web's vite.config.ts (Node side, at dev/build time).
 * The browser bundle needs no env: it talks to same-origin /api. If it ever
 * does, add `VITE_`-prefixed entries under `client` here.
 */
export function parseWebEnv(runtimeEnv: Record<string, string | undefined>) {
  return createEnv({
    server: {
      /** Sidecar port the dev server proxies /api to. */
      MAILFAST_PORT: port.default(DEV_API_PORT),
    },
    clientPrefix: "VITE_",
    client: {},
    runtimeEnv: runtimeEnv as RuntimeEnv,
    isServer: true,
    emptyStringAsUndefined: true,
    onValidationError: onValidationError("web"),
  });
}

export const env = parseWebEnv(process.env);
export type WebEnv = ReturnType<typeof parseWebEnv>;
