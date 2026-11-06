import { Database } from "bun:sqlite";
import { join } from "node:path";

/** SQLite releases this process lock on exit, including crashes. */
export function acquireServerOwnership(dataDir: string): () => void {
  const lock = new Database(join(dataDir, "server-owner.sqlite"), { create: true });
  try {
    lock.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE");
  } catch {
    lock.close();
    throw new Error("This mailbox already has a running Mailfast server. Connect to it with bun run dev:web.");
  }
  return () => lock.close();
}
