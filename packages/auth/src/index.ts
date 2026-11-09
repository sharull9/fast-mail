import { betterAuth } from "better-auth";
import { multiSession } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

/**
 * Better Auth configuration for Mailfast.
 *
 * Mailfast is a local desktop app, so Better Auth is used for what it is
 * good at here: the Google OAuth flow (PKCE + state), storing the Google
 * account with encrypted access/refresh tokens in our SQLite DB, and handing
 * back a valid (auto-refreshed) access token for Gmail API calls. The app's
 * own API is protected separately by the token Electron injects.
 *
 * Sign-in runs in the user's system browser (Google blocks embedded webviews):
 *   GET {baseURL}/auth/start  -> sets the OAuth state cookie, 302 to Google
 *   GET {baseURL}/auth/callback/google -> Better Auth stores user + account
 * so the state cookie is set and checked in the same browser.
 */
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
export const CONTACT_PHOTOS_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
export const CHAT_SCOPES = [
  "https://www.googleapis.com/auth/chat.spaces",
  "https://www.googleapis.com/auth/chat.messages",
  "https://www.googleapis.com/auth/chat.memberships.readonly",
];
export const AUTH_BASE_PATH = "/auth";

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

export interface MailAuthOptions {
  /** Drizzle database (bun:sqlite) that also holds the auth tables. */
  db: Parameters<typeof drizzleAdapter>[0];
  /** Drizzle tables keyed by Better Auth model name (user, session, account, verification). */
  schema?: Record<string, unknown>;
  /** ≥ 32 chars. Encrypts OAuth tokens at rest and signs cookies. */
  secret: string;
  /** Origin of the local sidecar, e.g. http://127.0.0.1:47821 */
  baseURL: string;
  /** Google "Desktop app" OAuth client. Null until the user configures one. */
  google: GoogleClient | null;
  /** Called after a Google account is linked or its tokens are refreshed via sign-in. */
  onGoogleAccount?: (account: { userId: string; accountId: string }) => void;
}

export function createMailAuth(opts: MailAuthOptions) {
  return betterAuth({
    appName: "Mailfast",
    plugins: [multiSession({ maximumSessions: 10 })],
    baseURL: opts.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: opts.secret,
    database: drizzleAdapter(opts.db, { provider: "sqlite", schema: opts.schema }),
    socialProviders: opts.google
      ? {
          google: {
            clientId: opts.google.clientId,
            clientSecret: opts.google.clientSecret,
            scope: [GMAIL_SCOPE, ...CHAT_SCOPES, CONTACT_PHOTOS_SCOPE],
            // Refresh token for background sync; consent each time so Google always returns one.
            accessType: "offline",
            prompt: "consent",
          },
        }
      : {},
    account: {
      encryptOAuthTokens: true,
      // Re-signing in with the same Google account updates its tokens and scopes.
      updateAccountOnSignIn: true,
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    trustedOrigins: [opts.baseURL],
    telemetry: { enabled: false },
    databaseHooks: {
      account: {
        create: {
          after: async (account) => {
            if (account.providerId === "google")
              opts.onGoogleAccount?.({ userId: account.userId, accountId: account.id });
          },
        },
        update: {
          after: async (account) => {
            if (account.providerId === "google")
              opts.onGoogleAccount?.({ userId: account.userId, accountId: account.id });
          },
        },
      },
    },
  });
}

export type MailAuth = ReturnType<typeof createMailAuth>;

/**
 * Starts Google sign-in from a browser request: asks Better Auth for the
 * authorization URL and turns its JSON reply into a redirect, keeping the
 * state cookie it sets.
 */
export async function startGoogleSignIn(auth: MailAuth, request: Request, callbackPath: string): Promise<Response> {
  const res = await auth.api.signInSocial({
    body: { provider: "google", callbackURL: callbackPath, errorCallbackURL: callbackPath, disableRedirect: true },
    // Use sign-in, never linkSocialAccount: different emails must create distinct users.
    headers: request.headers,
    asResponse: true,
  });
  const { url } = (await res.json()) as { url?: string };
  if (!res.ok || !url) return new Response("Could not start Google sign-in", { status: 500 });
  const headers = new Headers({ location: url, "cache-control": "no-store" });
  for (const cookie of res.headers.getSetCookie()) headers.append("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

/** A valid Google access token for the account, refreshed by Better Auth when it is about to expire. */
export async function googleAccessToken(auth: MailAuth, account: { userId: string; accountId: string }) {
  const res = await auth.api.getAccessToken({ body: { accountId: account.accountId, userId: account.userId } });
  return {
    token: res.accessToken,
    expiresAt: res.accessTokenExpiresAt ? new Date(res.accessTokenExpiresAt).getTime() : 0,
  };
}

/** True if the stored grant includes Gmail access (users can untick scopes on the consent screen). */
export function hasGmailScope(scope: string | null | undefined): boolean {
  return (scope ?? "").split(/[\s,]+/).includes(GMAIL_SCOPE);
}

/** True if the stored grant includes Google Chat access. */
export function hasChatScope(scope: string | null | undefined): boolean {
  const parts = (scope ?? "").split(/[\s,]+/);
  return CHAT_SCOPES.some((s) => parts.includes(s));
}
