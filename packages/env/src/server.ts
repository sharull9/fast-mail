import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { onValidationError, port, DEV_API_PORT, DEV_WEB_URL, type RuntimeEnv } from "./shared.ts";

function isLoopbackUiOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const loopback =
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host === "::1" ||
      /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(host);
    return (
      url.protocol === "http:" &&
      loopback &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/**
 * Environment of the Bun sidecar (apps/server). Electron sets the MAILFAST_*
 * values when it spawns the sidecar; GOOGLE_* can be set by a developer to
 * skip the setup screen.
 */
export function parseServerEnv(runtimeEnv: RuntimeEnv) {
  return createEnv({
    server: {
      NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
      /** 0 = pick a free port (production). Development uses a fixed port. */
      MAILFAST_PORT: port.default((runtimeEnv.NODE_ENV || "development") === "development" ? DEV_API_PORT : 0),
      /** Per-launch API token required on /api. Generated when unset (standalone dev). */
      MAILFAST_TOKEN: z.string().min(16).optional(),
      /** "desktop" when spawned by Electron, "standalone" for dev:web / manual runs. */
      MAILFAST_SERVER_MODE: z.enum(["desktop", "standalone"]).default("standalone"),
      /** Directory for runtime discovery records (~/.mailfast/run by default). */
      MAILFAST_RUN_DIR: z.string().min(1).optional(),
      /** Comma-separated loopback UI origins allowed to pair a browser session. */
      MAILFAST_UI_ORIGINS: z.string().default(DEV_WEB_URL),
      /** Where mail.sqlite lives. Defaults to apps/server/.data. */
      MAILFAST_DATA_DIR: z.string().min(1).optional(),
      /** Built web app to serve (production). */
      MAILFAST_STATIC_DIR: z.string().min(1).optional(),
      /** Drizzle migrations folder (needed by the compiled sidecar). */
      MAILFAST_MIGRATIONS_DIR: z.string().min(1).optional(),
      /** Better Auth secret from Electron (keychain-protected). */
      MAILFAST_SECRET_KEY: z.string().min(32, "must be at least 32 characters").optional(),
      /** Electron's PID; the sidecar exits when it disappears. */
      MAILFAST_PARENT_PID: z.coerce.number().int().positive().optional(),
      GOOGLE_CLIENT_ID: z
        .string()
        .endsWith(".apps.googleusercontent.com", "must be a Google OAuth client ID (…apps.googleusercontent.com)")
        .optional(),
      GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    },
    runtimeEnv,
    isServer: true,
    emptyStringAsUndefined: true,
    onValidationError: onValidationError("server"),
    createFinalSchema: (shape) =>
      z.object(shape).superRefine((env, ctx) => {
        if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
          ctx.addIssue({
            code: "custom",
            path: [env.GOOGLE_CLIENT_ID ? "GOOGLE_CLIENT_SECRET" : "GOOGLE_CLIENT_ID"],
            message: "set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither",
          });
        }
        if (env.MAILFAST_UI_ORIGINS.split(",").some((origin) => !isLoopbackUiOrigin(origin.trim()))) {
          ctx.addIssue({
            code: "custom",
            path: ["MAILFAST_UI_ORIGINS"],
            message: "must be comma-separated loopback HTTP origins like http://localhost:5199",
          });
        }
      }),
  });
}

export const env = parseServerEnv(process.env);
export type ServerEnv = ReturnType<typeof parseServerEnv>;
