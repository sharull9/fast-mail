import {
  AUTH_BASE_PATH,
  createMailAuth,
  googleAccessToken,
  hasGmailScope,
  startGoogleSignIn,
  type GoogleClient,
  type MailAuth,
} from "@mailfast/auth";
import { authSchema, type MailStore } from "@mailfast/db";
import { env } from "@mailfast/env/server";
import type { AuthStatus } from "@mailfast/shared";

/**
 * Glue between the sidecar and Better Auth (packages/auth):
 *  - builds the Better Auth instance from the saved Google client config
 *  - serves /auth/* (start, Better Auth's own routes, done page)
 *  - hands Gmail a valid access token, cached until shortly before expiry
 */
export class AuthError extends Error {}

const TICKET_TTL = 10 * 60_000;

export class Auth {
  private instance: MailAuth;
  private access: { token: string; expires: number } | null = null;
  private refreshing: Promise<string> | null = null;
  private tickets = new Map<string, number>();
  private listeners = new Set<() => void>();

  constructor(
    private readonly store: MailStore,
    private readonly baseURL: string,
    private readonly secret: string,
  ) {
    this.instance = this.build();
  }

  /** Secret for Better Auth: from Electron (OS keychain via safeStorage), else generated and kept in the DB. */
  static secretFor(store: MailStore, fromEnv: string | undefined): string {
    if (fromEnv) return fromEnv; // length validated by @mailfast/env
    let s = store.kvGet("secret_key_fallback");
    if (!s) {
      s = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
      store.kvSet("secret_key_fallback", s);
      console.warn("[auth] MAILFAST_SECRET_KEY not set; using a secret stored in the database.");
    }
    return s;
  }

  private build(): MailAuth {
    return createMailAuth({
      db: this.store.db,
      schema: authSchema,
      secret: this.secret,
      baseURL: this.baseURL,
      google: this.client(),
      onGoogleAccount: () => setTimeout(() => this.afterSignIn(), 0),
    });
  }

  /** Env vars win over the config saved from the setup screen. */
  client(): GoogleClient | null {
    const { GOOGLE_CLIENT_ID: id, GOOGLE_CLIENT_SECRET: secret } = env;
    if (id && secret) return { clientId: id, clientSecret: secret };
    const saved = this.store.kvGet("oauth_client");
    return saved ? (JSON.parse(saved) as GoogleClient) : null;
  }

  saveClient(cfg: GoogleClient) {
    this.store.kvSet(
      "oauth_client",
      JSON.stringify({ clientId: cfg.clientId.trim(), clientSecret: cfg.clientSecret.trim() }),
    );
    this.instance = this.build();
  }

  private google() {
    const acc = this.store.googleAccount();
    return acc && hasGmailScope(acc.scope) ? acc : null;
  }

  account(): string | null {
    return this.google()?.email ?? null;
  }

  status(): AuthStatus {
    const acc = this.google();
    return { configured: this.client() !== null, signedIn: acc !== null, account: acc?.email ?? null };
  }

  onSignedIn(fn: () => void) {
    this.listeners.add(fn);
  }

  private afterSignIn() {
    const acc = this.google();
    if (!acc) return;
    // Single mailbox: switching Google accounts drops the previous one and its cache.
    const previous = this.store.kvGet("synced_account");
    if (previous && previous.toLowerCase() !== acc.email.toLowerCase()) this.store.clearMailbox();
    this.store.kvSet("synced_account", acc.email);
    this.access = null;
    for (const fn of this.listeners) fn();
  }

  /** URL the system browser opens to begin Google sign-in. One-time, short-lived. */
  startLogin(): string {
    if (!this.client()) throw new AuthError("OAuth client is not configured");
    const now = Date.now();
    for (const [t, exp] of this.tickets) if (exp < now) this.tickets.delete(t);
    const ticket = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");
    this.tickets.set(ticket, now + TICKET_TTL);
    return `${this.baseURL}${AUTH_BASE_PATH}/start?ticket=${ticket}`;
  }

  /** Handles every request under /auth (no API token: these come from the system browser). */
  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === `${AUTH_BASE_PATH}/start`) {
      const ticket = url.searchParams.get("ticket") ?? "";
      const exp = this.tickets.get(ticket);
      this.tickets.delete(ticket);
      if (!exp || exp < Date.now()) return page("Sign-in link expired", "Start again from Mailfast.");
      return startGoogleSignIn(this.instance, req, `${AUTH_BASE_PATH}/done`);
    }
    if (url.pathname === `${AUTH_BASE_PATH}/done`) {
      const error = url.searchParams.get("error");
      if (error) return page("Sign-in failed", `Google sign-in did not complete (${error}). Try again from Mailfast.`);
      const acc = this.store.googleAccount();
      if (acc && !hasGmailScope(acc.scope)) {
        return page("Gmail access needed", "Please sign in again and allow Mailfast to read and organise your Gmail.");
      }
      return page("Signed in", `Mailfast is syncing ${acc?.email ?? "your mailbox"}. You can close this tab.`);
    }
    return this.instance.handler(req);
  }

  /** Valid Gmail access token. Better Auth refreshes and re-encrypts it in the DB. Single-flight. */
  async token(): Promise<string> {
    if (this.access && this.access.expires - 60_000 > Date.now()) return this.access.token;
    this.refreshing ??= (async () => {
      const acc = this.google();
      if (!acc) throw new AuthError("Not signed in");
      try {
        const { token, expiresAt } = await googleAccessToken(this.instance, acc);
        this.access = { token, expires: expiresAt || Date.now() + 50 * 60_000 };
        return token;
      } catch (e) {
        throw new AuthError(`Could not refresh Google access: ${e instanceof Error ? e.message : String(e)}`);
      }
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  invalidate() {
    this.access = null;
  }

  async signOut() {
    // Revoking the access token revokes the whole grant (including the refresh token).
    const token = this.google() ? await this.token().catch(() => null) : null;
    if (token) {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST" }).catch(
        () => {},
      );
    }
    this.access = null;
    this.store.clearAuth();
    this.store.clearMailbox();
  }
}

function page(title: string, message: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
     <body style="font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0f1115;color:#e8e8ea">
     <div style="text-align:center"><h2>${esc(title)}</h2><p>${esc(message)}</p></div></body>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}
