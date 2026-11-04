import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";
import { onValidationError, port, type RuntimeEnv } from "./shared.ts";

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
      MAILFAST_PORT: port.default(0),
      /** Per-launch API token required on /api. Generated when unset (standalone dev). */
      MAILFAST_TOKEN: z.string().min(16).optional(),
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
      }),
  });
}

export const env = parseServerEnv(process.env);
export type ServerEnv = ReturnType<typeof parseServerEnv>;
