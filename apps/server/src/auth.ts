import {
  AUTH_BASE_PATH,
  createMailAuth,
  googleAccessToken,
  hasGmailScope,
  startGoogleSignIn,
  type GoogleClient,
  type MailAuth,
} from "@mailfast/auth";
import { authSchema, type AppStore } from "@mailfast/db";
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
  private access = new Map<string, { token: string; expires: number }>();
  private refreshing = new Map<string, Promise<string>>();
  private tickets = new Map<string, number>();
  private listeners = new Set<(id: string) => void>();

  constructor(
    private readonly store: AppStore,
    private readonly baseURL: string,
    private readonly secret: string,
  ) {
    this.instance = this.build();
  }

  /** Secret for Better Auth: from Electron (OS keychain via safeStorage), else generated and kept in the DB. */
  static secretFor(store: AppStore, fromEnv: string | undefined): string {
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
      onGoogleAccount: ({ accountId }) => setTimeout(() => this.afterSignIn(accountId), 0),
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

  accounts() {
    return this.store.googleAccounts().filter((acc) => hasGmailScope(acc.scope));
  }

  activeId(): string | null {
    const accounts = this.accounts();
    const saved = this.store.kvGet("active_account");
    const id = accounts.find((a) => a.accountId === saved)?.accountId ?? accounts[0]?.accountId ?? null;
    if (id !== saved) {
      if (id) this.store.kvSet("active_account", id);
      else this.store.kvDel("active_account");
    }
    return id;
  }

  setActive(id: string) {
    if (!this.accounts().some((a) => a.accountId === id)) throw new AuthError("Unknown account");
    this.store.kvSet("active_account", id);
  }

  account(id = this.activeId()): string | null {
    return this.accounts().find((a) => a.accountId === id)?.email ?? null;
  }

  status(): AuthStatus {
    const activeAccountId = this.activeId();
    const accounts = this.accounts().map((a) => ({
      id: a.accountId,
      email: a.email,
      name: a.name,
      image: a.image,
      unread: 0,
    }));
    return {
      configured: this.client() !== null,
      signedIn: accounts.length > 0,
      account: this.account(activeAccountId),
      accounts,
      activeAccountId,
    };
  }

  onSignedIn(fn: (id: string) => void) {
    this.listeners.add(fn);
  }

  private afterSignIn(id: string) {
    if (!this.account(id)) return;
    this.activeId();
    this.access.delete(id);
    for (const fn of this.listeners) fn(id);
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
      const session = await this.instance.api.getSession({ headers: req.headers });
      const acc = this.store.googleAccounts().find((a) => a.userId === session?.user.id);
      if (acc && !hasGmailScope(acc.scope)) {
        return page("Gmail access needed", "Please sign in again and allow Mailfast to read and organise your Gmail.");
      }
      return page("Signed in", `Mailfast is syncing ${acc?.email ?? "your mailbox"}. You can close this tab.`);
    }
    return this.instance.handler(req);
  }

  /** Valid Gmail access token. Better Auth refreshes and re-encrypts it in the DB. Single-flight. */
  async token(id = this.activeId()): Promise<string> {
    if (!id) throw new AuthError("Not signed in");
    const cached = this.access.get(id);
    if (cached && cached.expires - 60_000 > Date.now()) return cached.token;
    let refreshing = this.refreshing.get(id);
    if (!refreshing) {
      refreshing = (async () => {
        const acc = this.accounts().find((a) => a.accountId === id);
        if (!acc) throw new AuthError("Not signed in");
        try {
          const { token, expiresAt } = await googleAccessToken(this.instance, acc);
          if (this.account(id)) this.access.set(id, { token, expires: expiresAt || Date.now() + 50 * 60_000 });
          return token;
        } catch (e) {
          throw new AuthError(`Could not refresh Google access: ${e instanceof Error ? e.message : String(e)}`);
        }
      })().finally(() => this.refreshing.delete(id));
      this.refreshing.set(id, refreshing);
    }
    return refreshing;
  }

  invalidate(id = this.activeId()) {
    if (id) this.access.delete(id);
  }

  async signOut(id?: string) {
    const ids = id ? [id] : this.accounts().map((a) => a.accountId);
    for (const accountId of ids) {
      const token = await this.token(accountId).catch(() => null);
      if (token)
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
          method: "POST",
          signal: AbortSignal.timeout(10_000),
        }).catch(() => {});
      this.access.delete(accountId);
      this.store.deleteGoogleAccount(accountId);
    }
    if (!id) this.store.clearAuth();
    this.activeId();
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
