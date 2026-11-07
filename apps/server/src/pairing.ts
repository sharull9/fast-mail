import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PairedBrowser } from "@mailfast/shared";

/**
 * Browser pairing for the local sidecar.
 *
 * An already-authenticated client (Electron header or an existing browser
 * session) asks for a PairingGrant: a short-lived, high-entropy, one-use code.
 * A browser redeems it at POST /api/session for its own HttpOnly cookie.
 * Only hashes are stored, so a memory dump never contains a usable code.
 * Session records are persisted by the server so paired browsers survive
 * restarts until they are revoked.
 */

export const PAIRING_GRANT_TTL_MS = 5 * 60_000;
const SESSION_PERSIST_INTERVAL_MS = 60_000;

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

export interface BrowserSessionMetadata {
  origin?: string | null;
  userAgent?: string | null;
}

/** Persisted record. `tokenHash` is never exposed through the API. */
export interface BrowserSessionRecord extends BrowserSessionMetadata {
  id: string;
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
  origin: string | null;
  userAgent: string | null;
}

/** One cookie session per paired browser; tokens are stored hashed. */
export class SessionStore {
  /** sha256(token) -> session record. */
  private sessions = new Map<string, BrowserSessionRecord>();
  private lastPersistAt = 0;

  constructor(
    records: BrowserSessionRecord[] = [],
    private readonly now: () => number = () => Date.now(),
    private readonly persist: (records: BrowserSessionRecord[]) => void = () => {},
  ) {
    for (const record of records) this.sessions.set(record.tokenHash, { ...record });
  }

  issue(metadata: BrowserSessionMetadata = {}): { token: string; id: string } {
    const token = randomBytes(32).toString("base64url");
    const at = this.now();
    const record: BrowserSessionRecord = {
      id: randomUUID(),
      tokenHash: hash(token),
      createdAt: at,
      lastSeenAt: at,
      origin: metadata.origin ?? null,
      userAgent: metadata.userAgent ?? null,
    };
    this.sessions.set(record.tokenHash, record);
    this.persistNow();
    return { token, id: record.id };
  }

  has(token: string): boolean {
    const record = this.sessions.get(hash(token));
    if (!record) return false;
    record.lastSeenAt = this.now();
    this.persistSoon();
    return true;
  }

  list(): PairedBrowser[] {
    return [...this.sessions.values()]
      .map((record) => ({
        id: record.id,
        createdAt: record.createdAt,
        lastSeenAt: record.lastSeenAt,
        origin: record.origin,
        userAgent: record.userAgent,
      }))
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  }

  /** Revokes a session by its public id; the token itself is never needed. */
  revoke(id: string): boolean {
    for (const [tokenHash, record] of this.sessions) {
      if (record.id !== id) continue;
      this.sessions.delete(tokenHash);
      this.persistNow();
      return true;
    }
    return false;
  }

  /** Revokes the session matching a raw cookie token (browser self-disconnect). */
  revokeToken(token: string): boolean {
    const tokenHash = hash(token);
    if (!this.sessions.delete(tokenHash)) return false;
    this.persistNow();
    return true;
  }

  snapshot(): BrowserSessionRecord[] {
    return [...this.sessions.values()]
      .map((record) => ({ ...record }))
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  private persistNow() {
    this.lastPersistAt = this.now();
    this.persist(this.snapshot());
  }

  private persistSoon() {
    const now = this.now();
    if (now - this.lastPersistAt >= SESSION_PERSIST_INTERVAL_MS) this.persistNow();
  }
}
