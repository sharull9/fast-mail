# Mailfast

A fast Gmail desktop client. Mail **metadata** (sender, recipients, subject, date, snippet, labels) is synced into a local SQLite cache. Every list, search and action is answered locally, and Gmail catches up in the background. Message bodies are intentionally out of scope for now.

```
Electron (apps/desktop)
  ├── UI: Vite+ · React · TanStack Start (SPA) · Router · Query · DB · Virtual   (apps/web)
  └── Bun sidecar: local HTTP API on 127.0.0.1                                 (apps/server)
        ├── Gmail API client: batch requests, field masks, priority rate limiter
        ├── Sync engine: inbox-first initial sync, history.list deltas, background backfill
        ├── Prefetch engine: hover / keyboard / label warm-up (gitfaster-style "just in time")
        ├── Outbox: optimistic actions persisted and replayed to Gmail
        ├── Auth: Better Auth (Google OAuth, encrypted tokens)            (packages/auth)
        └── SQLite via Drizzle: messages, threads, FTS5 search, auth      (packages/db)
packages/shared: types shared by server and UI
```

## Why it's fast

- **Local-first reads.** The UI never waits on Gmail. Lists are one indexed SQLite scan (`thread_labels(label_id, last_date)`), and search is FTS5 prefix matching over cached metadata. Both are served by the sidecar in a few milliseconds.
- **Inbox tabs.** All / Primary / Social / Updates map onto Gmail's category labels (`CATEGORY_*`) and are filtered in SQL before pagination, so each tab pages correctly. Mail that isn't in the inbox never shows up in them.
- **Local-only search.** `/api/search` answers exclusively from the FTS5 index — there is no Gmail `q=` fallback, so results only cover mail already synced locally. Prefix a term with `@user:` to match senders by name or email address; quote multi-word names and combine with free text:
  - `@user:alice` — mail from anyone named or addressed like "alice"
  - `@user:"Alice Cooper" invoice` — Alice's mail about invoices
  - `@user:bob@example.com` — mail from that exact address
- **Cheap sync.**
  - Message metadata is fetched through Gmail's batch endpoint (40 per HTTP call) with `fields=` masks.
  - New mail arrives via `history.list` deltas every 15 seconds and whenever the window gains focus.
  - Label-only changes apply without any fetch.
- **Inbox first.** The newest 100 inbox messages land before anything else. All mail is then backfilled newest-first at background priority. A priority token bucket (Gmail's 250 units/s) always serves user actions and prefetches ahead of backfill.
- **Instant actions.** Archive, delete, read and star update every open list through TanStack DB optimistic actions. The sidecar writes the change to SQLite and to a durable outbox, which retries against Gmail.
- **Prefetch on intent.**
  - Hovering a label or thread warms its data, through router `preload: "intent"` and explicit hover handlers.
  - `j`/`k` prefetch the neighbouring threads.
  - Threads that haven't been fully synced are fetched from Gmail when you show interest.
- **Virtualised lists.** Only visible rows are rendered.

## Setup

Requirements: [Bun](https://bun.sh) ≥ 1.4 and Node ≥ 22 (for Electron tooling).

```bash
bun install
# Electron's binary download is a postinstall step; if `apps/desktop/node_modules/electron/dist` is missing:
node apps/desktop/node_modules/electron/install.js
```

Google OAuth client (one-time):

1. In Google Cloud Console, create a project and **enable the Gmail API**.
2. Configure the OAuth consent screen. While the app is in "Testing", add your Google account as a test user.
3. Create credentials: **OAuth client ID**, application type **Desktop app**.
4. Paste the client ID and secret into Mailfast's setup screen. Alternatively, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` before launching.

Desktop clients accept any `127.0.0.1` loopback redirect, so no redirect URI needs registering. Sign-in opens in your system browser (Google blocks embedded webviews).

## Development

```bash
bun run dev                 # Vite dev server (5199) + Electron, which starts the Bun sidecar (47821)
bun run dev:web             # browser-only: reuses a running Mailfast server (desktop preferred) or starts a standalone one on a random port, then Vite
bun run dev:web:standalone  # same, but always uses the independent standalone profile (apps/server/.data), even while the desktop app runs
bun run dev:ui              # Vite only, when a mail service is already running and proxying correctly
bun run test                # bun test in packages that define it
bun run check               # vp check (format, lint, type check) + per-package tsc
bun run dist                # web build + compiled sidecar + electron-builder installer (apps/desktop/release)
```

Other useful commands:

```bash
bun run db:generate                          # Drizzle migration after editing packages/db/src/schema.ts
cd packages/auth && bun run generate:schema  # regenerate Better Auth tables after changing auth config/plugins
cd apps/server && bun run dev                # sidecar alone; defaults to port 47821 in development
bun run dev:ui                               # Vite only, when the sidecar is already running
```

### Browser alongside the desktop app

`bun run dev` starts Vite on `http://localhost:5199` and Electron, which starts the sidecar on `47821`. Opening `http://localhost:5199` in a normal browser uses the same UI and sidecar. The browser is not trusted automatically: the app asks the sidecar for a one-use pairing grant and opens `/#pair=<code>` in the system browser (or shows a code-entry form), which exchanges the code for an `HttpOnly`, `SameSite=Strict`, `Path=/api` session cookie — no token is exposed to page JavaScript.

For browser-only development, start the serial launcher from the repository root:

```bash
bun run dev:web
```

The launcher first looks for an already-running Mailfast server through runtime records in `~/.mailfast/run` (pid liveness plus a `/.well-known/mailfast` identity probe — no port scanning, and stale or foreign records are ignored). A running desktop instance is preferred; if none exists it starts a standalone server on a random port using `apps/server/.data`, waits for `READY`, and starts Vite with `MAILFAST_PORT` pointed at that port. A fresh standalone server prints a `PAIRING` grant on stdout, which the launcher turns into an `http://localhost:5199/#pair=<code>` URL to open once.

`bun run dev:web:standalone` skips desktop candidates and uses the independent standalone profile even while the desktop app is running. Both profiles keep their own data: standalone uses `apps/server/.data`, the desktop app uses Electron `userData` plus a keychain-protected secret.

If Vite is already running on `5199`, it is reused only when its proxied `/api/connection` reports the same server instance; otherwise the launcher prints a restart instruction rather than killing your process. To run a second dev copy, set both ports, for example `MAILFAST_PORT=47900 MAILFAST_UI_ORIGINS=http://localhost:5299` with `vp dev --port 5299`.

Each mailbox directory has a SQLite ownership lock, so two current servers cannot sync the same mailbox. If the configured development port is occupied by an older service without a discovery record, the launcher stops with a restart instruction. Restart older servers once after upgrading to enable discovery and pairing. For a different UI port, set `MAILFAST_UI_ORIGINS=http://localhost:5299` before running `bun run dev:web`; the launcher uses that origin's host and port.

A production sidecar serving `MAILFAST_STATIC_DIR` can be opened directly at `http://127.0.0.1:<port>`; that exact sidecar origin is trusted automatically, and pairing URLs point there as well.

## Environment

All environment access goes through `packages/env` (`@t3-oss/env-core` + zod). Each process imports only its own entry, so a bad value fails at startup with a readable message.

| Entry                   | Variable                                                                                                         | Default                           | Purpose                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------- |
| `@mailfast/env/server`  | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                                                                      | unset                             | Skip the setup screen (both or neither)                          |
|                         | `MAILFAST_PORT`                                                                                                  | `47821` in dev; `0` in production | Sidecar port                                                     |
|                         | `MAILFAST_DATA_DIR`                                                                                              | `apps/server/.data`               | Where `mail.sqlite` lives                                        |
|                         | `MAILFAST_TOKEN`, `MAILFAST_SECRET_KEY`, `MAILFAST_PARENT_PID`, `MAILFAST_STATIC_DIR`, `MAILFAST_MIGRATIONS_DIR` | set by Electron                   | Per-launch API token, Better Auth secret, watchdog, prod paths   |
|                         | `MAILFAST_SERVER_MODE`                                                                                           | `standalone`                      | `desktop` when spawned by Electron                               |
|                         | `MAILFAST_RUN_DIR`                                                                                               | `~/.mailfast/run`                 | Runtime discovery records for `dev:web`                          |
|                         | `MAILFAST_UI_ORIGINS`                                                                                            | `http://localhost:5199`           | Comma-separated loopback origins allowed to redeem pairing codes |
| `@mailfast/env/desktop` | `MAILFAST_DEV_URL`, `MAILFAST_PORT`                                                                              | `localhost:5199`, 47821           | Dev server URL and sidecar port                                  |
| `@mailfast/env/web`     | `MAILFAST_PORT`                                                                                                  | 47821                             | Port Vite proxies `/api` to                                      |

To run a second dev copy next to your main one: `MAILFAST_PORT=47900 MAILFAST_UI_ORIGINS=http://localhost:5299`, with `vp dev --port 5299` for the web app.

## Security model

- The sidecar binds to `127.0.0.1` only and is local-only: no account data or credentials ever leave the machine except the Gmail API calls it makes itself.
- Every `/api` request needs either the per-launch token or a paired browser session cookie.
  - Electron injects the token at the network layer, so renderer code never holds it.
  - Browsers pair explicitly: an already-authenticated client calls `POST /api/pairing-grants` for a five-minute, one-use, high-entropy code (only its hash is kept in memory, so a restart revokes everything). `POST /api/session` redeems the code — guarded by the `x-mailfast-ui` marker, exact trusted `Origin`/`Host` checks, a body-size bound and a redemption rate limit — and sets an `HttpOnly`, `SameSite=Strict`, `Path=/api` cookie named per server instance. `DELETE /api/session` revokes that browser only.
  - `GET /.well-known/mailfast` exposes only the public `ServerDescriptor` (product, protocol version, instance id, mode, origin); `GET /api/connection` is unauthenticated and reports whether the current request is paired.
  - Each running server drops a credential-free record (`pid`, `origin`, `instanceId`, `mode`) into `~/.mailfast/run/<instanceId>.json` and removes it on exit, which is how `dev:web` finds and reuses it.
  - `/auth/*` is reachable from the system browser. It is protected by a one-time ticket, Better Auth's OAuth state cookie, and PKCE.
- OAuth tokens are encrypted at rest (Better Auth `encryptOAuthTokens`).
  - The key is generated by Electron and protected by the OS keychain via `safeStorage`.
  - When the sidecar runs standalone, it falls back to a key stored in the database.
- The renderer runs with `contextIsolation`, `sandbox`, no Node integration, and a one-method preload bridge (`openExternal`: https URLs, the sidecar's own `/auth/start` sign-in link, and the `/#pair=` browser-pairing URL on our own UI origin).
- The sidecar exits when Electron exits, by watching its parent PID.

## Layout

| Path              | What                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| `apps/desktop`    | Electron main + preload, bundled with `vp pack`; packaging config              |
| `apps/web`        | TanStack Start SPA (prerendered shell), routes, data layer (`src/lib/data.ts`) |
| `apps/server`     | Bun sidecar: API, Gmail client, sync/prefetch engine, auth glue                |
| `packages/db`     | Drizzle schema, migrations (incl. FTS5), typed mail store                      |
| `packages/auth`   | Better Auth config, Google sign-in helpers, token access                       |
| `packages/env`    | Typed, validated environment (`@t3-oss/env-core` + zod), one entry per process |
| `packages/shared` | Shared types and label-delta helpers                                           |

## Not done yet

- Message bodies, compose and reply
- Push notifications (Gmail push needs Cloud Pub/Sub; polling plus focus-triggered sync is used instead)
- Multiple accounts (the Better Auth schema supports it; the sync engine is single-mailbox today)
