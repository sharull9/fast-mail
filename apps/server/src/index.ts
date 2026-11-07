import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { openAppStore } from "@mailfast/db";
import { env } from "@mailfast/env/server";
import {
  AUTH_HEADER,
  sendMessageRequestSchema,
  threadActionsRequestSchema,
  type ConnectionStatus,
  type ListThreadsResponse,
  type PairingGrant,
  type SendMessageResponse,
  type ServerDescriptor,
  type ThreadDetail,
} from "@mailfast/shared";
import { Auth, AuthError } from "@/auth.ts";
import { Events } from "@/events.ts";
import { Accounts } from "@/accounts.ts";
import { PairingGrants, SessionStore, type BrowserSessionRecord } from "@/pairing.ts";
import { acquireServerOwnership } from "@/server-ownership.ts";
import { listThreadsResponse } from "@/threads.ts";

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
const UI_BOOTSTRAP_HEADER = "x-mailfast-ui";
const pairingGrants = new PairingGrants();
const redeemAttempts: number[] = [];
let trustedOrigins = new Set<string>();
let trustedHosts = new Set<string>();

interface AttachmentTicket {
  accountId: string;
  messageId: string;
  attachmentId: string;
  expiresAt: number;
}
const attachmentTickets = new Map<string, AttachmentTicket>();

function issueAttachmentTicket(accountId: string, messageId: string, attachmentId: string): string {
  const token = randomBytes(24).toString("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000;
  attachmentTickets.set(token, { accountId, messageId, attachmentId, expiresAt });
  return token;
}

function validateAttachmentTicket(token: string, messageId: string, attachmentId: string): string | null {
  const ticket = attachmentTickets.get(token);
  if (!ticket) return null;
  if (Date.now() > ticket.expiresAt) {
    attachmentTickets.delete(token);
    return null;
  }
  if (ticket.messageId !== messageId || ticket.attachmentId !== attachmentId) {
    return null;
  }
  return ticket.accountId;
}
let descriptor!: ServerDescriptor;
let pairBaseOrigin = "";

const appStore = openAppStore({ path: join(dataDir, "mail.sqlite"), migrationsFolder: env.MAILFAST_MIGRATIONS_DIR });
const events = new Events();

const BROWSER_SESSION_STORE_KEY = "browser_sessions";
const BROWSER_SESSION_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

function isBrowserSessionRecord(value: unknown): value is BrowserSessionRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.tokenHash === "string" &&
    record.tokenHash.length === 64 &&
    typeof record.createdAt === "number" &&
    typeof record.lastSeenAt === "number" &&
    (record.origin === null || typeof record.origin === "string") &&
    (record.userAgent === null || typeof record.userAgent === "string")
  );
}

function loadBrowserSessionStore(): { namespace: string; sessions: BrowserSessionRecord[] } {
  const fresh = () => ({ namespace: randomBytes(8).toString("hex"), sessions: [] });
  const raw = appStore.kvGet(BROWSER_SESSION_STORE_KEY);
  if (!raw) return fresh();
  try {
    const parsed = JSON.parse(raw) as { namespace?: unknown; sessions?: unknown };
    if (typeof parsed.namespace !== "string" || parsed.namespace.length === 0) return fresh();
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions.filter(isBrowserSessionRecord) : [];
    return { namespace: parsed.namespace, sessions };
  } catch {
    return fresh();
  }
}

const browserSessionStore = loadBrowserSessionStore();
const SESSION_COOKIE = `mailfast_session_${browserSessionStore.namespace}`;
const browserSessions = new SessionStore(
  browserSessionStore.sessions,
  () => Date.now(),
  (sessions) => {
    appStore.kvSet(BROWSER_SESSION_STORE_KEY, JSON.stringify({ namespace: browserSessionStore.namespace, sessions }));
  },
);

// Better Auth needs the final origin (for the OAuth redirect URI), so these are created once the port is bound.
let auth!: Auth;
let accounts!: Accounts;

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

function electronAuthorized(req: Request): boolean {
  const header = req.headers.get(AUTH_HEADER);
  return header !== null && tokenEquals(header, apiToken);
}

function authorized(req: Request): boolean {
  if (electronAuthorized(req)) return true;
  const cookie = sessionCookie(req);
  return cookie !== null && browserRequestAllowed(req) && browserSessions.has(cookie);
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
  const { token } = browserSessions.issue({
    origin: req.headers.get("origin"),
    userAgent: req.headers.get("user-agent")?.slice(0, 200) ?? null,
  });
  return json({ ok: true }, 200, {
    "set-cookie": `${SESSION_COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${BROWSER_SESSION_COOKIE_MAX_AGE}`,
  });
}

/** DELETE /api/session: revoke this browser's session cookie only. */
function revokeBrowserSession(req: Request): Response {
  const token = sessionCookie(req);
  if (token === null || !browserRequestAllowed(req) || !browserSessions.has(token)) {
    return json({ error: "unauthorized" }, 401);
  }
  browserSessions.revokeToken(token);
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

      // Management of paired browser sessions.
      if (path === "/api/browser-sessions" || path.startsWith("/api/browser-sessions/")) {
        if (!authorized(req)) return json({ error: "unauthorized" }, 401);
        if (path === "/api/browser-sessions") {
          if (req.method === "GET") {
            const token = sessionCookie(req);
            return json(browserSessions.list(token));
          }
          return json({ error: "method not allowed" }, 405);
        }
        const sessionMatch = path.match(/^\/api\/browser-sessions\/([\w-]+)$/);
        if (sessionMatch && req.method === "DELETE") {
          const targetId = sessionMatch[1]!;
          if (!electronAuthorized(req)) {
            const token = sessionCookie(req);
            const currentSession = token ? browserSessions.findByToken(token) : null;
            if (token === null || !currentSession || currentSession.id !== targetId) {
              return json({ error: "forbidden: browsers may only disconnect themselves" }, 403);
            }
            browserSessions.revokeToken(token);
            return json({ ok: true }, 200, {
              "set-cookie": `${SESSION_COOKIE}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0`,
            });
          }
          if (!browserSessions.revoke(targetId)) return json({ error: "not found" }, 404);
          return json({ ok: true });
        }
        return json({ error: "not found" }, 404);
      }

      if (!path.startsWith("/api/")) return serveStatic(path);

      // Attachment download/stream: accepts either valid ticket or regular auth
      const attachmentMatch = path.match(/^\/api\/messages\/([^/]+)\/attachments\/(.+)$/);
      if (attachmentMatch && req.method === "GET") {
        const messageId = decodeURIComponent(attachmentMatch[1]!);
        const attachmentId = decodeURIComponent(attachmentMatch[2]!);
        const ticketParam = url.searchParams.get("ticket");
        let targetAccountId: string | null = null;
        if (ticketParam) {
          targetAccountId = validateAttachmentTicket(ticketParam, messageId, attachmentId);
        }
        if (!targetAccountId && !authorized(req)) return json({ error: "unauthorized" }, 401);

        try {
          const runtime = targetAccountId
            ? (accounts.get(targetAccountId) ?? accounts.resolve(req))
            : accounts.resolve(req);
          if (!runtime.gmail) return json({ error: "Gmail client not available" }, 500);
          const raw = await runtime.gmail.getAttachment(messageId, attachmentId);
          const buf = Buffer.from(raw.data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
          const filename = url.searchParams.get("filename") || "attachment";
          const mimeType = url.searchParams.get("mimeType") || "application/octet-stream";
          const download = url.searchParams.get("download") === "1" || url.searchParams.has("download");
          const disposition = download ? "attachment" : "inline";
          const safeFilename = filename.replace(/["\r\n]/g, "_");
          const encodedFilename = encodeURIComponent(filename);

          return new Response(buf, {
            status: 200,
            headers: {
              "content-type": mimeType,
              "content-length": String(buf.length),
              "content-disposition": `${disposition}; filename="${safeFilename}"; filename*=UTF-8''${encodedFilename}`,
              "cache-control": "private, max-age=86400",
            },
          });
        } catch (err) {
          console.error("[attachment] error loading attachment:", err);
          return json({ error: err instanceof Error ? err.message : "Failed to load attachment" }, 502);
        }
      }

      if (!authorized(req)) return json({ error: "unauthorized" }, 401);

      try {
        // ---- auth
        if (path === "/api/auth/status") return json(accounts.status());
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
          return json(accounts.status());
        }
        if (path === "/api/auth/login" && req.method === "POST") return json({ url: auth.startLogin() });
        if ((path === "/api/auth/logout" || path === "/api/logout") && req.method === "POST") {
          return json(await accounts.logout());
        }
        if (path === "/api/accounts/active" && req.method === "POST") {
          const b = await body<{ id?: unknown }>(req);
          if (typeof b.id !== "string") return json({ error: "Account ID required" }, 400);
          auth.setActive(b.id);
          return json(accounts.status());
        }
        const logoutMatch = path.match(/^\/api\/accounts\/([\w-]+)\/logout$/);
        if (logoutMatch && req.method === "POST") return json(await accounts.logout(logoutMatch[1]!));

        // ---- pairing (existing auth only: Electron header or a paired browser)
        if (path === "/api/pairing-grants" && req.method === "POST") return json(issueGrant());

        // ---- attachment ticket for external browser opening
        if (path === "/api/attachment-ticket" && req.method === "POST") {
          const b = await body<{ messageId?: string; attachmentId?: string; filename?: string; mimeType?: string }>(
            req,
          );
          if (!b.messageId || !b.attachmentId) return json({ error: "messageId and attachmentId required" }, 400);
          const accountId = req.headers.get("x-mailfast-account") ?? auth.activeId() ?? "";
          const ticket = issueAttachmentTicket(accountId, b.messageId, b.attachmentId);
          const params = new URLSearchParams({
            ticket,
            filename: b.filename || "attachment",
            mimeType: b.mimeType || "application/octet-stream",
          });
          const serverOrigin = descriptor?.origin ?? `http://127.0.0.1:${server.port}`;
          const attachmentUrl = `${serverOrigin}/api/messages/${encodeURIComponent(b.messageId)}/attachments/${encodeURIComponent(b.attachmentId)}?${params.toString()}`;
          return json({ ticket, url: attachmentUrl });
        }

        // All subscribers receive account-tagged events, including background unread changes.
        if (path === "/api/events") {
          // Fetch streaming supports the account header, unlike native EventSource.
          if (auth.activeId()) accounts.resolve(req);
          srv.timeout(req, 0);
          return events.stream();
        }
        if (path === "/api/sync" && req.method === "POST" && !auth.activeId() && !req.headers.has("x-mailfast-account"))
          return json({ ok: true });
        const { store, sync } = accounts.resolve(req);

        // ---- sync
        if (path === "/api/status") return json(sync.status());
        if (path === "/api/sync" && req.method === "POST") {
          sync.wake();
          return json({ ok: true });
        }

        // ---- reads (always local)
        if (path === "/api/labels") return json(store.labels());
        if (path === "/api/threads" && req.method === "GET") {
          return listThreadsResponse(url, { store, sync });
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
          const hasBodies = store.hasThreadBodies(id);
          if (!local || !hasBodies) {
            await sync.ensureThread(id, true); // unknown thread or missing bodies: wait for Gmail once
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
          const parsed = threadActionsRequestSchema.safeParse(await req.json().catch(() => null));
          if (!parsed.success) {
            return json({ error: parsed.error.issues[0]?.message ?? "bad request" }, 400);
          }
          const b = parsed.data;
          sync.applyAction(b.threadIds.slice(0, 500), b.action);
          return json({ threads: b.threadIds.map((id) => store.getThread(id)?.thread).filter(Boolean) });
        }

        // ---- send message
        if (path === "/api/messages/send" && req.method === "POST") {
          const parsed = sendMessageRequestSchema.safeParse(await req.json().catch(() => null));
          if (!parsed.success) {
            return json({ error: parsed.error.issues[0]?.message ?? "Invalid message request" }, 400);
          }
          const b = parsed.data;
          const runtime = accounts.resolve(req);
          if (!runtime.gmail) return json({ error: "Gmail client not available" }, 500);

          const sent = await runtime.gmail.sendMessage({
            to: b.to,
            cc: b.cc,
            bcc: b.bcc,
            subject: b.subject,
            bodyHtml: b.bodyHtml || `<p>${b.bodyText ?? ""}</p>`,
            bodyText: b.bodyText,
            threadId: b.threadId,
            inReplyTo: b.inReplyTo,
            references: b.references,
            attachments: b.attachments,
          });

          if (sent.threadId) {
            try {
              await runtime.sync.ensureThread(sent.threadId, true);
            } catch (err) {
              console.warn("[send] failed to immediately sync thread:", err);
            }
          }

          return json(sent satisfies SendMessageResponse);
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

auth = new Auth(appStore, origin, Auth.secretFor(appStore, env.MAILFAST_SECRET_KEY));
accounts = new Accounts(auth, events, dataDir, env.MAILFAST_MIGRATIONS_DIR);

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
  void accounts.close().finally(() => {
    appStore.close();
    process.exit(0);
  });
});

accounts.refresh();
console.log(`READY ${JSON.stringify({ port: server.port, pid: process.pid, instanceId, origin })}`);
if (mode === "standalone") {
  // First browser pairing for a fresh standalone server: the launcher turns
  // this into an `/#pair=CODE` URL. Never logged anywhere else.
  console.log(`PAIRING ${JSON.stringify(issueGrant())}`);
}
