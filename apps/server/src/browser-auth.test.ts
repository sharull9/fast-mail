import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  AUTH_HEADER,
  type ConnectionStatus,
  type PairedBrowser,
  type PairingGrant,
  type ServerDescriptor,
} from "@mailfast/shared";

const TOKEN = "test-token-0123456789abcdef";
const UI_ORIGIN = "http://localhost:5199";
const CUSTOM_UI_ORIGIN = "http://127.0.0.1:5299";
const UI_HEADER = "x-mailfast-ui";

let proc: ChildProcess | undefined;
let port = 0;
let base = "";
let dataDir = "";
let descriptor: ServerDescriptor;

function rawStatus(method: string, path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end();
  });
}

async function grant(headers: Record<string, string> = { [AUTH_HEADER]: TOKEN }): Promise<PairingGrant> {
  const res = await fetch(`${base}/api/pairing-grants`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });
  expect(res.status).toBe(200);
  return (await res.json()) as PairingGrant;
}

function redeem(code: string, headers: Record<string, string> = {}) {
  return fetch(`${base}/api/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: UI_ORIGIN,
      [UI_HEADER]: "1",
      ...headers,
    },
    body: JSON.stringify({ code }),
  });
}

/** Redeems a fresh grant and returns the browser's `name=value` cookie pair. */
async function pairBrowser(origin: string = UI_ORIGIN, headers: Record<string, string> = {}): Promise<string> {
  const { code } = await grant();
  const res = await redeem(code, { origin, ...headers });
  expect(res.status).toBe(200);
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("mailfast_session_"));
  expect(setCookie).toBeDefined();
  expect(setCookie).toContain("HttpOnly");
  expect(setCookie).toContain("SameSite=Strict");
  expect(setCookie).toContain("Path=/api");
  expect(setCookie).toContain("Max-Age=34560000");
  return setCookie!.split(";")[0]!;
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "mailfast-auth-"));
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
      MAILFAST_UI_ORIGINS: `${UI_ORIGIN},${CUSTOM_UI_ORIGIN}`,
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
    createInterface({ input: child.stderr! }).on("line", (line) => console.error(`[server] ${line}`));
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`server exited during startup (${code})`)));
  });
  base = `http://127.0.0.1:${port}`;

  const res = await fetch(`${base}/.well-known/mailfast`);
  descriptor = (await res.json()) as ServerDescriptor;
});

afterAll(async () => {
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    proc.kill();
    await new Promise((resolve) => proc!.once("exit", resolve));
  }
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test("well-known publishes a public descriptor with no credentials", async () => {
  expect(descriptor.product).toBe("mailfast");
  expect(descriptor.protocolVersion).toBe(1);
  expect(descriptor.instanceId).toBeTruthy();
  expect(descriptor.mode).toBe("standalone");
  expect(descriptor.origin).toBe(base);
  expect(Object.keys(descriptor).sort()).toEqual(["instanceId", "mode", "origin", "product", "protocolVersion"]);
});

test("api still requires the Electron token or a paired browser", async () => {
  expect((await fetch(`${base}/api/auth/status`)).status).toBe(401);
  expect((await fetch(`${base}/api/auth/status`, { headers: { [AUTH_HEADER]: TOKEN } })).status).toBe(200);
  expect((await fetch(`${base}/api/auth/status`, { headers: { [AUTH_HEADER]: "wrong" } })).status).toBe(401);
});

test("connection status is public and reflects request credentials", async () => {
  const anon = (await (await fetch(`${base}/api/connection`)).json()) as ConnectionStatus;
  expect(anon.server.instanceId).toBe(descriptor.instanceId);
  expect(anon.paired).toBe(false);

  const electron = (await (
    await fetch(`${base}/api/connection`, { headers: { [AUTH_HEADER]: TOKEN } })
  ).json()) as ConnectionStatus;
  expect(electron.paired).toBe(true);
});

test("pairing grants require existing auth", async () => {
  const noAuth = await fetch(`${base}/api/pairing-grants`, { method: "POST", body: "{}" });
  expect(noAuth.status).toBe(401);
  const badAuth = await fetch(`${base}/api/pairing-grants`, {
    method: "POST",
    headers: { [AUTH_HEADER]: "wrong" },
    body: "{}",
  });
  expect(badAuth.status).toBe(401);

  const g = await grant();
  expect(g.code.length).toBeGreaterThan(20);
  expect(g.expiresAt).toBeGreaterThan(Date.now());
  expect(g.url).toContain("/#pair=");
  expect(g.url).toContain(g.code);
});

test("grant redemption requires the marker, trusted origin and allowed host", async () => {
  const g = await grant();
  // Missing marker.
  expect(
    (
      await fetch(`${base}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: UI_ORIGIN },
        body: JSON.stringify({ code: g.code }),
      })
    ).status,
  ).toBe(403);
  // Missing origin on a mutation.
  expect(
    (
      await fetch(`${base}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json", [UI_HEADER]: "1" },
        body: JSON.stringify({ code: g.code }),
      })
    ).status,
  ).toBe(403);
  // Untrusted and malformed origins.
  expect((await redeem(g.code, { origin: "http://localhost:3000" })).status).toBe(403);
  expect((await redeem(g.code, { origin: "https://evil.example" })).status).toBe(403);
  // Untrusted Host.
  expect(
    await rawStatus("POST", "/api/session", {
      host: "evil.example",
      origin: UI_ORIGIN,
      [UI_HEADER]: "1",
      "content-type": "application/json",
      cookie: "",
    }),
  ).toBe(403);
  // The grant is still valid afterwards.
  expect((await redeem(g.code)).status).toBe(200);
});

test("wrong, missing and replayed codes fail", async () => {
  expect((await redeem("not-a-real-code")).status).toBe(400);
  expect((await redeem("")).status).toBe(400);
  const g = await grant();
  expect((await redeem(g.code)).status).toBe(200);
  // One-use: the same code cannot mint a second session.
  expect((await redeem(g.code)).status).toBe(400);
});

test("paired browser gets a unique cookie that authenticates requests", async () => {
  const cookieA = await pairBrowser();
  const cookieB = await pairBrowser(CUSTOM_UI_ORIGIN);
  expect(cookieA).not.toBe(cookieB);

  const statusA = await fetch(`${base}/api/auth/status`, {
    headers: { cookie: cookieA, "sec-fetch-site": "same-origin" },
  });
  expect(statusA.status).toBe(200);

  const conn = (await (
    await fetch(`${base}/api/connection`, { headers: { cookie: cookieB, origin: CUSTOM_UI_ORIGIN } })
  ).json()) as ConnectionStatus;
  expect(conn.paired).toBe(true);

  const write = await fetch(`${base}/api/sync`, {
    method: "POST",
    headers: { cookie: cookieA, origin: UI_ORIGIN, "content-type": "application/json" },
    body: "{}",
  });
  expect(write.status).toBe(200);
});

test("Electron token can list and revoke paired browser sessions", async () => {
  const revokeCookie = await pairBrowser(UI_ORIGIN, { "user-agent": "Revocation Test" });
  const keepCookie = await pairBrowser(CUSTOM_UI_ORIGIN, { "user-agent": "Keep Test" });

  expect((await fetch(`${base}/api/browser-sessions`)).status).toBe(401);
  expect(
    (
      await fetch(`${base}/api/browser-sessions`, {
        headers: { cookie: revokeCookie, origin: UI_ORIGIN },
      })
    ).status,
  ).toBe(401);

  const list = await fetch(`${base}/api/browser-sessions`, { headers: { [AUTH_HEADER]: TOKEN } });
  expect(list.status).toBe(200);
  const sessions = (await list.json()) as PairedBrowser[];
  expect(sessions.some((session) => session.userAgent === "Revocation Test")).toBe(true);
  expect(sessions.some((session) => session.userAgent === "Keep Test")).toBe(true);
  expect(sessions.every((session) => !("tokenHash" in session))).toBe(true);

  const target = sessions.find((session) => session.userAgent === "Revocation Test")!;
  const del = await fetch(`${base}/api/browser-sessions/${target.id}`, {
    method: "DELETE",
    headers: { [AUTH_HEADER]: TOKEN },
  });
  expect(del.status).toBe(200);
  expect(
    (
      await fetch(`${base}/api/browser-sessions/${target.id}`, {
        method: "DELETE",
        headers: { [AUTH_HEADER]: TOKEN },
      })
    ).status,
  ).toBe(404);

  expect(
    (await fetch(`${base}/api/auth/status`, { headers: { cookie: revokeCookie, "sec-fetch-site": "same-origin" } }))
      .status,
  ).toBe(401);
  expect(
    (await fetch(`${base}/api/auth/status`, { headers: { cookie: keepCookie, "sec-fetch-site": "same-origin" } }))
      .status,
  ).toBe(200);
});

test("browser cookie rejects cross-origin and ambiguous requests", async () => {
  const c = await pairBrowser();
  expect(
    (await fetch(`${base}/api/auth/status`, { headers: { cookie: c, "sec-fetch-site": "cross-site" } })).status,
  ).toBe(401);
  expect(
    (
      await fetch(`${base}/api/sync`, {
        method: "POST",
        headers: { cookie: c, origin: "http://localhost:3000", "content-type": "application/json" },
        body: "{}",
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await fetch(`${base}/api/sync`, {
        method: "POST",
        headers: { cookie: c, "sec-fetch-site": "same-origin", "content-type": "application/json" },
        body: "{}",
      })
    ).status,
  ).toBe(401);
  expect(await rawStatus("GET", "/api/auth/status", { cookie: c, host: "evil.example" })).toBe(401);
});

test("DELETE /api/session revokes only that browser", async () => {
  const cookieA = await pairBrowser();
  const cookieB = await pairBrowser();

  const del = await fetch(`${base}/api/session`, {
    method: "DELETE",
    headers: { cookie: cookieA, origin: UI_ORIGIN },
  });
  expect(del.status).toBe(200);
  expect(del.headers.getSetCookie().some((c) => c.startsWith("mailfast_session_") && c.includes("Max-Age=0"))).toBe(
    true,
  );

  // Revoked cookie no longer authenticates; the other browser is unaffected.
  expect(
    (await fetch(`${base}/api/auth/status`, { headers: { cookie: cookieA, "sec-fetch-site": "same-origin" } })).status,
  ).toBe(401);
  expect(
    (await fetch(`${base}/api/auth/status`, { headers: { cookie: cookieB, "sec-fetch-site": "same-origin" } })).status,
  ).toBe(200);
  // Electron's header path is untouched.
  expect((await fetch(`${base}/api/auth/status`, { headers: { [AUTH_HEADER]: TOKEN } })).status).toBe(200);

  // Deleting without a browser session is rejected.
  expect((await fetch(`${base}/api/session`, { method: "DELETE", headers: { [AUTH_HEADER]: TOKEN } })).status).toBe(
    401,
  );
});

test("a paired browser can mint further grants", async () => {
  const cookie = await pairBrowser();
  const res = await fetch(`${base}/api/pairing-grants`, {
    method: "POST",
    headers: { cookie, origin: UI_ORIGIN, "content-type": "application/json" },
    body: "{}",
  });
  expect(res.status).toBe(200);
});

test("grant redemption is rate limited", async () => {
  let saw429 = false;
  for (let i = 0; i < 30 && !saw429; i++) {
    const res = await redeem(`guess-${i}`);
    if (res.status === 429) saw429 = true;
  }
  expect(saw429).toBe(true);
});
