import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { AUTH_HEADER } from "@mailfast/shared";

const TOKEN = "test-token-0123456789abcdef";
let proc: ChildProcess | undefined;
let port = 0;
let base = "";
let dataDir = "";

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mailfast-attachment-"));
  const child = spawn("bun", ["index.ts"], {
    cwd: import.meta.dir,
    env: {
      ...process.env,
      NODE_ENV: "test",
      MAILFAST_PORT: "0",
      MAILFAST_DATA_DIR: dataDir,
      MAILFAST_RUN_DIR: join(dataDir, "run"),
      MAILFAST_TOKEN: TOKEN,
      MAILFAST_SECRET_KEY: "test-secret-key-0123456789abcdef",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc = child;

  port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not become ready")), 15_000);
    createInterface({ input: child.stdout! }).on("line", (line) => {
      if (line.startsWith("READY ")) {
        clearTimeout(timer);
        resolve((JSON.parse(line.slice(6)) as { port: number }).port);
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`server exited during startup (${code})`)));
  });
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (proc) {
    proc.kill();
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

test("attachment endpoints require auth without ticket", async () => {
  const res = await fetch(`${base}/api/messages/msg123/attachments/att456`);
  expect(res.status).toBe(401);

  const ticketRes = await fetch(`${base}/api/attachment-ticket`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messageId: "msg123", attachmentId: "att456" }),
  });
  expect(ticketRes.status).toBe(401);
});

test("attachment ticket issuance generates token and ticket-authorized URL", async () => {
  const ticketRes = await fetch(`${base}/api/attachment-ticket`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [AUTH_HEADER]: TOKEN,
    },
    body: JSON.stringify({
      messageId: "msg123",
      attachmentId: "att456",
      filename: "test.pdf",
      mimeType: "application/pdf",
    }),
  });
  expect(ticketRes.status).toBe(200);
  const data = (await ticketRes.json()) as { ticket: string; url: string };
  expect(data.ticket).toBeDefined();
  expect(data.ticket.length).toBeGreaterThan(10);
  expect(data.url).toContain(data.ticket);
  expect(data.url).toContain("test.pdf");

  // Invalid ticket returns 401
  const invalidRes = await fetch(`${base}/api/messages/msg123/attachments/att456?ticket=invalid-ticket`);
  expect(invalidRes.status).toBe(401);
});
