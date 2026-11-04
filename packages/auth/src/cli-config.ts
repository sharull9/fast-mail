// Used only by `bun run generate:schema` (Better Auth CLI) to emit the Drizzle
// auth schema into packages/db. Never imported at runtime.
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { createMailAuth } from "./index.ts";

export const auth = createMailAuth({
  db: drizzle({ client: new Database(":memory:") }),
  secret: "schema-generation-only-secret-0123456789",
  baseURL: "http://127.0.0.1",
  google: { clientId: "x", clientSecret: "y" },
});
