import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { DEV_API_PORT, DEV_WEB_URL, onValidationError, port, type RuntimeEnv } from "./shared.ts";

/** Environment of the Electron main process (apps/desktop). Only read in development. */
export function parseDesktopEnv(runtimeEnv: RuntimeEnv) {
  return createEnv({
    server: {
      /** Vite dev server the window loads in development. */
      MAILFAST_DEV_URL: z.url().default(DEV_WEB_URL),
      /** Sidecar port in development (Vite proxies /api here). */
      MAILFAST_PORT: port.default(DEV_API_PORT),
    },
    runtimeEnv,
    isServer: true,
    emptyStringAsUndefined: true,
    onValidationError: onValidationError("desktop"),
  });
}

export const env = parseDesktopEnv(process.env);
export type DesktopEnv = ReturnType<typeof parseDesktopEnv>;
