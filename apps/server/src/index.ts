import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { openMailStore } from "@mailfast/db";
import { env } from "@mailfast/env/server";
import {
  AUTH_HEADER,
  type ConnectionStatus,
  type ListThreadsResponse,
  type PairingGrant,
  type ServerDescriptor,
  type ThreadAction,
  type ThreadDetail,
} from "@mailfast/shared";
import { Auth, AuthError } from "@/auth.ts";
import { Events } from "@/events.ts";
import { Gmail } from "@/gmail.ts";
import { PairingGrants, SessionStore } from "@/pairing.ts";
import { acquireServerOwnership } from "@/server-ownership.ts";
import { SyncEngine } from "@/sync.ts";

/**
 * Local HTTP API, launched by Electron as a sidecar (videorc/opencode style):
 *  - binds 127.0.0.1 only; port from MAILFAST_PORT (dev) or random (prod)
 *  - every /api request needs the per-launch token Electron injects as a header,
 *    or a per-browser cookie minted by redeeming a one-use pairing grant
 *  - publishes a credential-free runtime record in ~/.mailfast/run so dev:web
 *    can discover and reuse this instance instead of starting a second one
 *  - prints `READY {json}` once listening; standalone mode also prints a
 *    `PAIRING {json}` line with an initial one-use grant for the launcher
 */
const dataDir = resolve(env.MAILFAST_DATA_DIR ?? join(import.meta.dir, "../.data"));
mkdirSync(dataDir, { recursive: true });
const releaseOwnership = acquireServerOwnership(dataDir);
process.on("exit", releaseOwnership);
const apiToken = env.MAILFAST_TOKEN ?? crypto.randomUUID();
const instanceId = crypto.randomUUID();
const mode = env.MAILFAST_SERVER_MODE;
const staticDir = env.MAILFAST_STATIC_DIR ? resolve(env.MAILFAST_STATIC_DIR) : null;
const SESSION_COOKIE = `mailfast_session_${instanceId.replaceAll("-", "")}`;
const UI_BOOTSTRAP_HEADER = "x-mailfast-ui";
const pairingGrants = new PairingGrants();
const browserSessions = new SessionStore();
const redeemAttempts: number[] = [];
let trustedOrigins = new Set<string>();
let trustedHosts = new Set<string>();
let descriptor!: ServerDescriptor;
let pairBaseOrigin = "";

const store = openMailStore({ path: join(dataDir, "mail.sqlite"), migrationsFolder: env.MAILFAST_MIGRATIONS_DIR });
const events = new Events();
// Better Auth needs the final origin (for the OAuth redirect URI), so these are created once the port is bound.
let auth!: Auth;
let sync!: SyncEngine;

const ACTIONS = new Set<ThreadAction["kind"]>([
  "archive",
  "inbox",
  "trash",
  "untrash",
  "read",
  "unread",
  "star",
  "unstar",
  "important",
  "unimportant",
]);

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { "cache-control": "no-store", ...headers } });
}

function tokenEquals(got: string, want: string): boolean {
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionCookie(req: Request): string | null {
  for (const part of req.headers.get("cookie")?.split(";") ?? []) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

function browserRequestAllowed(req: Request): boolean {
  if (!trustedHosts.has(req.headers.get("host") ?? "")) return false;
  const origin = req.headers.get("origin");
  if (origin) return trustedOrigins.has(origin);
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  return req.headers.get("sec-fetch-site") === "same-origin";
}

function authorized(req: Request): boolean {
  const header = req.headers.get(AUTH_HEADER);
  if (header !== null && tokenEquals(header, apiToken)) return true;
  const cookie = sessionCookie(req);
  return cookie !== null && browserSessions.has(cookie) && browserRequestAllowed(req);
}

/** Throttles grant-code guessing: 20 redemption attempts per minute, per server. */
function redeemAllowed(): boolean {
  const now = Date.now();
  while (redeemAttempts.length > 0 && redeemAttempts[0]! <= now - 60_000) redeemAttempts.shift();
  if (redeemAttempts.length >= 20) return false;
  redeemAttempts.push(now);
  return true;
}

function issueGrant(): PairingGrant {
  const { code, expiresAt } = pairingGrants.issue();
  return { code, expiresAt, url: `${pairBaseOrigin}/#pair=${code}` };
}

/** POST /api/session: redeem a one-use pairing grant for this browser's cookie. */
async function redeemPairingCode(req: Request): Promise<Response> {
  if (req.headers.get(UI_BOOTSTRAP_HEADER) !== "1" || !browserRequestAllowed(req)) {
    return json({ error: "forbidden" }, 403);
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > 8192) return json({ error: "payload too large" }, 413);
  if (!redeemAllowed()) return json({ error: "too many attempts, try again later" }, 429);
  const b = await body<{ code?: unknown }>(req);
  if (typeof b.code !== "string") return json({ error: "pairing code required" }, 400);
  if (!pairingGrants.consume(b.code)) return json({ error: "invalid or expired pairing code" }, 400);
  const token = browserSessions.issue();
  return json({ ok: true }, 200, {
    "set-cookie": `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict`,
  });
}

/** DELETE /api/session: revoke this browser's session cookie only. */
function revokeBrowserSession(req: Request): Response {
  const token = sessionCookie(req);
  if (token === null || !browserSessions.has(token) || !browserRequestAllowed(req)) {
    return json({ error: "unauthorized" }, 401);
  }
  browserSessions.revoke(token);
  return json({ ok: true }, 200, {
    "set-cookie": `${SESSION_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0`,
  });
}

async function body<T>(req: Request): Promise<T> {
  return (await req.json().catch(() => ({}))) as T;
}

async function explainBindFailure(err: unknown): Promise<never> {
  const port = env.MAILFAST_PORT;
  let detail = "";
  if (port !== 0) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/.well-known/mailfast`, {
        signal: AbortSignal.timeout(1500),
      });
      const d = res.ok
        ? ((await res.json().catch(() => null)) as { product?: string; instanceId?: string; mode?: string } | null)
        : null;
      detail =
        d?.product === "mailfast"
          ? ` Another Mailfast instance is already serving http://127.0.0.1:${port} (mode ${d.mode ?? "?"}, instance ${d.instanceId ?? "?"}).`
          : ` Port ${port} is occupied by a non-Mailfast service.`;
    } catch {
      detail = ` Port ${port} is occupied by a service that did not answer the identity probe.`;
    }
  }
  console.error(
    `[server] Could not bind ${port === 0 ? "a port" : `port ${port}`}: ${err instanceof Error ? err.message : String(err)}.${detail} Set MAILFAST_PORT to a free port or stop the conflicting process.`,
  );
  process.exit(1);
}

let server!: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: env.MAILFAST_PORT,
    idleTimeout: 60,
    routes: {
      // Google sign-in in the system browser, handled by Better Auth. No API token here:
      // the flow is protected by a one-time ticket, the OAuth state cookie and PKCE.
      "/auth/*": (req) => auth.handle(req),
    },
    async fetch(req, srv) {
      const url = new URL(req.url);
      const path = url.pathname;

      // Public identity probe: no secrets, used by dev:web discovery and browsers.
      if (path === "/.well-known/mailfast" && req.method === "GET") return json(descriptor);

      // Connection gate: unauthenticated; `paired` reflects this request's credentials.
      if (path === "/api/connection" && req.method === "GET") {
        return json({ server: descriptor, paired: authorized(req) } satisfies ConnectionStatus);
      }

      // Pairing session lifecycle (custom handling: grants, not the API token).
      if (path === "/api/session") {
        if (req.method === "POST") return redeemPairingCode(req);
        if (req.method === "DELETE") return revokeBrowserSession(req);
        return json({ error: "method not allowed" }, 405);
      }

      if (!path.startsWith("/api/")) return serveStatic(path);
      if (!authorized(req)) return json({ error: "unauthorized" }, 401);

      try {
        // ---- auth
        if (path === "/api/auth/status") return json(auth.status());
        if (path === "/api/auth/config" && req.method === "POST") {
          const b = await body<{ clientId?: string; clientSecret?: string }>(req);
          if (!b.clientId?.endsWith(".apps.googleusercontent.com") || !b.clientSecret) {
            return json(
              {
                error: "Enter the Client ID (…apps.googleusercontent.com) and Client secret of a Desktop OAuth client.",
              },
              400,
            );
          }
          auth.saveClient({ clientId: b.clientId, clientSecret: b.clientSecret });
          return json(auth.status());
        }
        if (path === "/api/auth/login" && req.method === "POST") return json({ url: auth.startLogin() });
        if (path === "/api/auth/logout" && req.method === "POST") {
          sync.stop();
          await auth.signOut();
          events.send({ type: "status", status: sync.status() });
          events.labelsChanged();
          return json(auth.status());
        }

        // ---- pairing (existing auth only: Electron header or a paired browser)
        if (path === "/api/pairing-grants" && req.method === "POST") return json(issueGrant());

        // ---- sync
        if (path === "/api/status") return json(sync.status());
        if (path === "/api/sync" && req.method === "POST") {
          sync.wake();
          return json({ ok: true });
        }
        if (path === "/api/events") {
          srv.timeout(req, 0); // long-lived SSE
          return events.stream();
        }

        // ---- reads (always local)
        if (path === "/api/labels") return json(store.labels());
        if (path === "/api/threads" && req.method === "GET") {
          const label = url.searchParams.get("label") ?? "INBOX";
          const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 1000);
          const before = Number(url.searchParams.get("before") ?? Number.MAX_SAFE_INTEGER);
          void sync.ensureLabel(label);
          const threads = store.listThreads(label, before, limit);
          return json({ threads, hasMore: threads.length === limit } satisfies ListThreadsResponse);
        }
        if (path === "/api/search") {
          const q = url.searchParams.get("q") ?? "";
          const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 1000);
          return json({ threads: store.searchThreads(q, limit), hasMore: false } satisfies ListThreadsResponse);
        }
        const threadMatch = path.match(/^\/api\/threads\/([\w-]+)$/);
        if (threadMatch && req.method === "GET") {
          const id = threadMatch[1]!;
          const local = store.getThread(id);
          if (!local) {
            await sync.ensureThread(id); // unknown thread: wait for Gmail once
            const after = store.getThread(id);
            if (!after) return json({ error: "not found" }, 404);
            return json({
              thread: after.thread,
              messages: store.threadMessages(id),
              complete: after.complete,
            } satisfies ThreadDetail);
          }
          void sync.ensureThread(id);
          const backfillDone = store.kvGet("backfill_done") === "1";
          return json({
            thread: local.thread,
            messages: store.threadMessages(id),
            complete: local.complete || backfillDone,
          } satisfies ThreadDetail);
        }

        // ---- writes (optimistic + outbox)
        if (path === "/api/threads/actions" && req.method === "POST") {
          const b = await body<{ threadIds?: string[]; action?: ThreadAction }>(req);
          if (!b.action || !ACTIONS.has(b.action.kind) || !Array.isArray(b.threadIds) || b.threadIds.length === 0) {
            return json({ error: "bad request" }, 400);
          }
          sync.applyAction(b.threadIds.slice(0, 500), b.action);
          return json({ threads: b.threadIds.map((id) => store.getThread(id)?.thread).filter(Boolean) });
        }

        // ---- prefetch hints from the UI (hover / keyboard focus / visible rows)
        if (path === "/api/prefetch" && req.method === "POST") {
          const b = await body<{ threadIds?: string[]; labelIds?: string[] }>(req);
          for (const id of (b.threadIds ?? []).slice(0, 20)) void sync.ensureThread(id);
          for (const id of (b.labelIds ?? []).slice(0, 10)) void sync.ensureLabel(id);
          return json({ ok: true });
        }

        return json({ error: "not found" }, 404);
      } catch (e) {
        if (e instanceof AuthError) return json({ error: e.message }, 400);
        console.error(e);
        return json({ error: e instanceof Error ? e.message : String(e) }, 500);
      }
    },
  });
} catch (err) {
  await explainBindFailure(err);
}

const origin = `http://127.0.0.1:${server.port}`;
descriptor = { product: "mailfast", protocolVersion: 1, instanceId, mode, origin };
const uiOrigin = env.MAILFAST_UI_ORIGINS.split(",")
  .map((o) => o.trim())
  .filter(Boolean)[0];
trustedOrigins = new Set([origin, ...env.MAILFAST_UI_ORIGINS.split(",").map((o) => new URL(o.trim()).origin)]);
trustedHosts = new Set([...trustedOrigins].map((o) => new URL(o).host));
// Where a pairing URL should point: the built SPA is served by the sidecar
// itself in production; in development the UI lives on the Vite origin.
pairBaseOrigin = staticDir ? origin : uiOrigin ? new URL(uiOrigin).origin : origin;

// Runtime record for dev:web discovery: credential-free, removed on exit.
// Stale files (dead pid, PID reuse, wrong instance) are tolerated and cleaned
// up by the discoverer.
const runDir = env.MAILFAST_RUN_DIR ?? join(homedir(), ".mailfast", "run");
try {
  mkdirSync(runDir, { recursive: true });
  const recordFile = join(runDir, `${instanceId}.json`);
  const tmpFile = `${recordFile}.${process.pid}.tmp`;
  writeFileSync(tmpFile, JSON.stringify({ instanceId, pid: process.pid, origin, mode, startedAt: Date.now() }));
  renameSync(tmpFile, recordFile);
  process.on("exit", () => {
    try {
      rmSync(recordFile, { force: true });
    } catch {
      /* best effort */
    }
  });
} catch (e) {
  console.warn("[server] could not publish runtime record:", e instanceof Error ? e.message : e);
}

auth = new Auth(store, origin, Auth.secretFor(store, env.MAILFAST_SECRET_KEY));
sync = new SyncEngine(store, new Gmail(auth), auth, events);

async function serveStatic(path: string): Promise<Response> {
  if (!staticDir) return new Response("Not found", { status: 404 });
  const rel = decodeURIComponent(path).replace(/^\/+/, "");
  const target = resolve(staticDir, rel);
  if (rel && target.startsWith(staticDir + sep)) {
    const file = Bun.file(target);
    if (await file.exists()) {
      const immutable = rel.startsWith("assets/");
      return new Response(file, {
        headers: { "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" },
      });
    }
  }
  // SPA fallback: TanStack Start's prerendered shell.
  for (const shell of ["_shell.html", "index.html"]) {
    const f = Bun.file(join(staticDir, shell));
    if (await f.exists())
      return new Response(f, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
  }
  return new Response("Not found", { status: 404 });
}

// Exit with the parent (Electron) so the sidecar never outlives the app.
const parentPid = env.MAILFAST_PARENT_PID ?? 0;
if (parentPid > 0) {
  setInterval(() => {
    try {
      process.kill(parentPid, 0);
    } catch {
      process.exit(0);
    }
  }, 2000);
}
process.on("SIGTERM", () => {
  sync.stop();
  store.close();
  process.exit(0);
});

sync.start();
console.log(`READY ${JSON.stringify({ port: server.port, pid: process.pid, instanceId, origin })}`);
if (mode === "standalone") {
  // First browser pairing for a fresh standalone server: the launcher turns
  // this into an `/#pair=CODE` URL. Never logged anywhere else.
  console.log(`PAIRING ${JSON.stringify(issueGrant())}`);
}
