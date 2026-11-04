import { z } from "zod";

export type RuntimeEnv = Record<string, string | undefined>;

/** Fixed sidecar port in development, so Vite can proxy /api to it. */
export const DEV_API_PORT = 47821;
/** Vite dev server for apps/web. */
export const DEV_WEB_URL = "http://localhost:5199";

export const port = z.coerce.number().int().min(0).max(65_535);

/** Fails fast with a readable list instead of a stack of zod internals. */
export function onValidationError(scope: string) {
  return (issues: readonly { message: string; path?: readonly (PropertyKey | { key: PropertyKey })[] }[]): never => {
    const lines = issues.map((i) => {
      const key = (i.path ?? []).map((p) => (typeof p === "object" ? String(p.key) : String(p))).join(".");
      return `  - ${key || "(env)"}: ${i.message}`;
    });
    throw new Error(`Invalid ${scope} environment variables:\n${lines.join("\n")}`);
  };
}
