import { createHash, randomBytes } from "node:crypto";

/**
 * Browser pairing for the local sidecar.
 *
 * An already-authenticated client (Electron header or an existing browser
 * session) asks for a PairingGrant: a short-lived, high-entropy, one-use code.
 * A browser redeems it at POST /api/session for its own HttpOnly cookie.
 * Only hashes are stored, so a memory dump never contains a usable code, and
 * everything is in memory: a server restart revokes all outstanding grants
 * and sessions.
 */

export const PAIRING_GRANT_TTL_MS = 5 * 60_000;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class PairingGrants {
  /** sha256(code) -> expiry timestamp. */
  private grants = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  issue(): { code: string; expiresAt: number } {
    this.sweep();
    const code = randomBytes(24).toString("base64url");
    const expiresAt = this.now() + PAIRING_GRANT_TTL_MS;
    this.grants.set(hash(code), expiresAt);
    return { code, expiresAt };
  }

  /** Atomically consumes a grant. Missing, expired and already-used codes all fail. */
  consume(code: string): boolean {
    if (typeof code !== "string" || code.length === 0 || code.length > 128) return false;
    const key = hash(code);
    const expiresAt = this.grants.get(key);
    if (expiresAt === undefined) return false;
    this.grants.delete(key); // one-use, even when expired
    return expiresAt > this.now();
  }

  private sweep() {
    const now = this.now();
    for (const [key, expiresAt] of this.grants) if (expiresAt <= now) this.grants.delete(key);
  }
}

/** One cookie session per paired browser; tokens are stored hashed. */
export class SessionStore {
  private tokens = new Set<string>();

  issue(): string {
    const token = randomBytes(32).toString("base64url");
    this.tokens.add(hash(token));
    return token;
  }

  has(token: string): boolean {
    return this.tokens.has(hash(token));
  }

  /** Revokes a single browser session; other sessions are unaffected. */
  revoke(token: string): void {
    this.tokens.delete(hash(token));
  }
}
