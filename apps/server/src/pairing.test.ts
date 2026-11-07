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
  const a = sessions.issue({ origin: "http://localhost:5199", userAgent: "Test Browser" });
  const b = sessions.issue();
  expect(a.token).not.toBe(b.token);
  expect(a.id).not.toBe(b.id);
  expect(sessions.has(a.token)).toBe(true);
  expect(sessions.has("forged")).toBe(false);
  sessions.revoke(a.id);
  expect(sessions.has(a.token)).toBe(false);
  expect(sessions.has(b.token)).toBe(true);
});

test("sessions expose public metadata and restore from a snapshot", () => {
  let now = 1_000;
  const sessions = new SessionStore([], () => now);
  const first = sessions.issue({ origin: "http://localhost:5199", userAgent: "Firefox" });
  now += 1_000;
  const second = sessions.issue({ origin: "http://localhost:5299" });

  const listed = sessions.list();
  expect(listed).toHaveLength(2);
  expect(listed[0]?.id).toBe(second.id);
  expect(listed[1]).toMatchObject({
    id: first.id,
    origin: "http://localhost:5199",
    userAgent: "Firefox",
  });
  expect(listed[0]).not.toHaveProperty("tokenHash");

  const restored = new SessionStore(sessions.snapshot(), () => now);
  expect(restored.has(first.token)).toBe(true);
  expect(restored.has(second.token)).toBe(true);
  restored.revoke(first.id);
  expect(restored.has(first.token)).toBe(false);
  expect(restored.has(second.token)).toBe(true);
});
