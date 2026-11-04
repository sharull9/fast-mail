import { mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { openMailStore } from "@mailfast/db";
import { AUTH_HEADER, type ListThreadsResponse, type ThreadAction, type ThreadDetail } from "@mailfast/shared";
import { Auth, AuthError } from "./auth.ts";
import { Events } from "./events.ts";
import { Gmail } from "./gmail.ts";
import { SyncEngine } from "./sync.ts";

/**
 * Local HTTP API, launched by Electron as a sidecar (videorc/opencode style):
 *  - binds 127.0.0.1 only; port from MAILFAST_PORT (dev) or random (prod)
 *  - every /api request needs the per-launch token Electron injects as a header,
 *    so the renderer never holds it and other local processes can't call us
 *  - prints `READY {json}` on stdout once listening
 */
const env = process.env;
const dataDir = resolve(env.MAILFAST_DATA_DIR ?? join(import.meta.dir, "../.data"));
mkdirSync(dataDir, { recursive: true });
const apiToken = env.MAILFAST_TOKEN ?? crypto.randomUUID();
const staticDir = env.MAILFAST_STATIC_DIR ? resolve(env.MAILFAST_STATIC_DIR) : null;

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

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function authorized(req: Request): boolean {
  const got = Buffer.from(req.headers.get(AUTH_HEADER) ?? "");
  const want = Buffer.from(apiToken);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function body<T>(req: Request): Promise<T> {
  return (await req.json().catch(() => ({}))) as T;
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(env.MAILFAST_PORT ?? 0),
  idleTimeout: 60,
  routes: {
    // Google sign-in in the system browser, handled by Better Auth. No API token here:
    // the flow is protected by a one-time ticket, the OAuth state cookie and PKCE.
    "/auth/*": (req) => auth.handle(req),
  },
  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (!path.startsWith("/api/")) return serveStatic(path);
    if (!authorized(req)) return json({ error: "unauthorized" }, 401);

    try {
      // ---- auth
      if (path === "/api/auth/status") return json(auth.status());
      if (path === "/api/auth/config" && req.method === "POST") {
        const b = await body<{ clientId?: string; clientSecret?: string }>(req);
        if (!b.clientId?.endsWith(".apps.googleusercontent.com") || !b.clientSecret) {
          return json(
            { error: "Enter the Client ID (…apps.googleusercontent.com) and Client secret of a Desktop OAuth client." },
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
        void sync.remoteSearch(q);
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

auth = new Auth(store, `http://127.0.0.1:${server.port}`, Auth.secretFor(store, env.MAILFAST_SECRET_KEY));
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
const parentPid = Number(env.MAILFAST_PARENT_PID ?? 0);
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
console.log(`READY ${JSON.stringify({ port: server.port, pid: process.pid })}`);
if (!env.MAILFAST_TOKEN) console.log(`[dev] API token: ${apiToken}`);
