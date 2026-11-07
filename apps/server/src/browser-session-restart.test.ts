import { afterAll, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { AUTH_HEADER, type PairedBrowser, type PairingGrant } from "@mailfast/shared";

const TOKEN = "restart-test-token-0123456789";
const UI_ORIGIN = "http://localhost:5199";
const UI_HEADER = "x-mailfast-ui";

let dataDir = "";
let proc: ChildProcess | undefined;

async function startServer(): Promise<string> {
  const child = spawn("bun", ["index.ts"], {
    cwd: import.meta.dir,
    env: {
      ...process.env,
      NODE_ENV: "test",
      MAILFAST_PORT: "0",
      MAILFAST_DATA_DIR: dataDir,
      MAILFAST_RUN_DIR: join(dataDir, "run"),
      MAILFAST_TOKEN: TOKEN,
      MAILFAST_SECRET_KEY: "restart-test-secret-key-0123456789abcdef",
      MAILFAST_UI_ORIGINS: UI_ORIGIN,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc = child;

  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not become ready")), 15_000);
    createInterface({ input: child.stdout! }).on("line", (line) => {
      if (line.startsWith("READY ")) {
        clearTimeout(timer);
        resolve((JSON.parse(line.slice(6)) as { port: number }).port);
      }
    });
    createInterface({ input: child.stderr! }).on("line", (line) => console.error(`[server] ${line}`));
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`server exited during startup (${code})`)));
  });
  return `http://127.0.0.1:${port}`;
}

async function stopServer() {
  const child = proc;
  proc = undefined;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

afterAll(async () => {
  await stopServer();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test("paired browser session survives a server restart on the same profile", async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mailfast-restart-"));
  const first = await startServer();

  const grant = await fetch(`${first}/api/pairing-grants`, {
    method: "POST",
    headers: { "content-type": "application/json", [AUTH_HEADER]: TOKEN },
    body: "{}",
  });
  expect(grant.status).toBe(200);
  const { code } = (await grant.json()) as PairingGrant;

  const redeem = await fetch(`${first}/api/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: UI_ORIGIN,
      [UI_HEADER]: "1",
      "user-agent": "Restart Test",
    },
    body: JSON.stringify({ code }),
  });
  expect(redeem.status).toBe(200);
  const setCookie = redeem.headers.getSetCookie().find((cookie) => cookie.startsWith("mailfast_session_"));
  expect(setCookie).toBeDefined();
  const cookie = setCookie!.split(";")[0]!;

  await stopServer();
  const second = await startServer();

  const status = await fetch(`${second}/api/auth/status`, {
    headers: { cookie, "sec-fetch-site": "same-origin" },
  });
  expect(status.status).toBe(200);

  const list = await fetch(`${second}/api/browser-sessions`, { headers: { [AUTH_HEADER]: TOKEN } });
  expect(list.status).toBe(200);
  const sessions = (await list.json()) as PairedBrowser[];
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ origin: UI_ORIGIN, userAgent: "Restart Test" });
});
