import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireServerOwnership } from "@/server-ownership.ts";

test("one server owns a mailbox, and stopping it releases ownership", () => {
  const dir = mkdtempSync(join(tmpdir(), "mailfast-owner-"));
  let release: (() => void) | undefined;
  try {
    release = acquireServerOwnership(dir);
    expect(() => acquireServerOwnership(dir)).toThrow("already has a running");
    release();
    release = undefined;
    release = acquireServerOwnership(dir);
  } finally {
    release?.();
    rmSync(dir, { recursive: true, force: true });
  }
});
