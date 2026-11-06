import { expect, test } from "bun:test";
import { PAIRING_GRANT_TTL_MS, PairingGrants, SessionStore } from "@/pairing.ts";

test("grants are high-entropy, expire and are single-use", () => {
  let now = 1_000;
  const grants = new PairingGrants(() => now);
  const a = grants.issue();
  const b = grants.issue();
  expect(a.code).not.toBe(b.code);
  expect(a.code.length).toBeGreaterThan(20);
  expect(a.expiresAt).toBe(now + PAIRING_GRANT_TTL_MS);

  expect(grants.consume("wrong-code")).toBe(false);
  expect(grants.consume(a.code)).toBe(true);
  expect(grants.consume(a.code)).toBe(false); // replay fails
  expect(grants.consume(b.code)).toBe(true);
});

test("expired grants fail and are swept", () => {
  let now = 0;
  const grants = new PairingGrants(() => now);
  const { code } = grants.issue();
  now = PAIRING_GRANT_TTL_MS + 1;
  expect(grants.consume(code)).toBe(false);
  // Issuing again sweeps expired entries without affecting live grants.
  const fresh = grants.issue();
  expect(grants.consume(fresh.code)).toBe(true);
});

test("sessions issue, verify and revoke independently", () => {
  const sessions = new SessionStore();
  const a = sessions.issue();
  const b = sessions.issue();
  expect(a).not.toBe(b);
  expect(sessions.has(a)).toBe(true);
  expect(sessions.has("forged")).toBe(false);
  sessions.revoke(a);
  expect(sessions.has(a)).toBe(false);
  expect(sessions.has(b)).toBe(true);
});
