import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerDescriptor } from "@mailfast/shared";
import { discoverServers, type DiscoveryDeps, type RuntimeRecord } from "@/service-discovery.ts";

const LIVE_PID = 4321;
const DEAD_PID = 999999;

let dirs: string[] = [];
function runDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mailfast-discovery-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function record(partial: Partial<RuntimeRecord> & { instanceId: string }): RuntimeRecord {
  return {
    pid: LIVE_PID,
    origin: "http://127.0.0.1:47821",
    mode: "standalone",
    startedAt: 1000,
    ...partial,
  };
}

function writeRecord(dir: string, r: unknown, name?: string) {
  writeFileSync(join(dir, name ?? `${(r as RuntimeRecord).instanceId}.json`), JSON.stringify(r));
}

function descriptorFor(r: RuntimeRecord, over: Partial<ServerDescriptor> = {}): ServerDescriptor {
  return {
    product: "mailfast",
    protocolVersion: 1,
    instanceId: r.instanceId,
    mode: r.mode,
    origin: r.origin,
    ...over,
  };
}

/** pidAlive returns true only for LIVE_PID; probe answers per-origin. */
function deps(probes: Record<string, ServerDescriptor | null | Error>): DiscoveryDeps {
  return {
    pidAlive: (pid) => pid === LIVE_PID,
    probe: async (origin) => {
      const v = probes[origin];
      if (v instanceof Error) throw v;
      return v ?? null;
    },
  };
}

describe("discoverServers", () => {
  test("empty or missing run dir yields nothing", async () => {
    expect(await discoverServers(join(tmpdir(), "mailfast-no-such-dir-xyz"))).toEqual([]);
    expect(await discoverServers(runDir())).toEqual([]);
  });

  test("live record with matching identity is discovered", async () => {
    const dir = runDir();
    const r = record({ instanceId: "inst-1", origin: "http://127.0.0.1:47821" });
    writeRecord(dir, r);
    const found = await discoverServers(dir, deps({ [r.origin]: descriptorFor(r) }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ instanceId: "inst-1", port: 47821, mode: "standalone", pid: LIVE_PID });
  });

  test("desktop is preferred over standalone", async () => {
    const dir = runDir();
    const standalone = record({ instanceId: "sa", origin: "http://127.0.0.1:5001", startedAt: 2000 });
    const desktop = record({ instanceId: "dk", origin: "http://127.0.0.1:5002", mode: "desktop", startedAt: 1000 });
    writeRecord(dir, standalone);
    writeRecord(dir, desktop);
    const found = await discoverServers(
      dir,
      deps({
        [standalone.origin]: descriptorFor(standalone),
        [desktop.origin]: descriptorFor(desktop),
      }),
    );
    expect(found.map((f) => f.instanceId)).toEqual(["dk", "sa"]);
  });

  test("dead pid records are removed and ignored", async () => {
    const dir = runDir();
    const r = record({ instanceId: "dead", pid: DEAD_PID });
    writeRecord(dir, r);
    const found = await discoverServers(dir, deps({}));
    expect(found).toEqual([]);
    expect(existsSync(join(dir, "dead.json"))).toBe(false);
  });

  test("live pid with no Mailfast behind the origin is stale (PID reuse)", async () => {
    const dir = runDir();
    const r = record({ instanceId: "reused" });
    writeRecord(dir, r);
    // Probe answers but is a different instance — not ours.
    const found = await discoverServers(dir, deps({ [r.origin]: descriptorFor(r, { instanceId: "someone-else" }) }));
    expect(found).toEqual([]);
    expect(existsSync(join(dir, "reused.json"))).toBe(false);
  });

  test("unreachable or non-Mailfast origins are ignored and cleaned", async () => {
    const dir = runDir();
    const down = record({ instanceId: "down", origin: "http://127.0.0.1:5003" });
    const err = record({ instanceId: "err", origin: "http://127.0.0.1:5004" });
    writeRecord(dir, down);
    writeRecord(dir, err);
    const found = await discoverServers(dir, deps({ [err.origin]: new Error("boom") }));
    expect(found).toEqual([]);
    expect(existsSync(join(dir, "down.json"))).toBe(false);
    expect(existsSync(join(dir, "err.json"))).toBe(false);
  });

  test("non-loopback record origins are never probed", async () => {
    const dir = runDir();
    const r = record({ instanceId: "evil", origin: "https://169.254.169.254/latest" });
    writeRecord(dir, r);
    let probed = false;
    const found = await discoverServers(dir, {
      pidAlive: () => true,
      probe: async () => {
        probed = true;
        return null;
      },
    });
    expect(found).toEqual([]);
    expect(probed).toBe(false);
    expect(existsSync(join(dir, "evil.json"))).toBe(false);
  });

  test("malformed records are removed", async () => {
    const dir = runDir();
    writeFileSync(join(dir, "broken.json"), "{not json");
    writeRecord(dir, { instanceId: "bad", pid: "x", origin: 1 } as never);
    expect(await discoverServers(dir, deps({}))).toEqual([]);
    expect(existsSync(join(dir, "broken.json"))).toBe(false);
    expect(existsSync(join(dir, "bad.json"))).toBe(false);
  });

  test("duplicate records for the same instance collapse", async () => {
    const dir = runDir();
    const a = record({ instanceId: "dup", origin: "http://127.0.0.1:5005" });
    const b = record({ instanceId: "dup", origin: "http://127.0.0.1:5005", startedAt: 3000 });
    writeRecord(dir, a);
    writeRecord(dir, b, "dup-copy.json");
    const found = await discoverServers(dir, deps({ [a.origin]: descriptorFor(a) }));
    expect(found).toHaveLength(1);
  });
});
