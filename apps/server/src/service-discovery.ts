import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ServerDescriptor } from "@mailfast/shared";

/**
 * Discovery of running Mailfast servers for `dev:web`, T3-Code style:
 * servers publish a credential-free runtime record in a user-owned directory
 * (~/.mailfast/run/<instanceId>.json) containing pid/origin/instanceId/mode.
 * A candidate counts only when the pid is alive AND the origin answers
 * GET /.well-known/mailfast with a descriptor whose instanceId matches the
 * record — so stale files and recycled pids are tolerated, and no port is
 * ever scanned.
 */

export interface RuntimeRecord {
  instanceId: string;
  pid: number;
  origin: string;
  mode: "desktop" | "standalone";
  startedAt: number;
}

export interface DiscoveredServer {
  instanceId: string;
  mode: "desktop" | "standalone";
  origin: string;
  port: number;
  pid: number;
  startedAt: number;
}

export interface DiscoveryDeps {
  pidAlive?: (pid: number) => boolean;
  probe?: (origin: string) => Promise<ServerDescriptor | null>;
}

function isLoopbackHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    return (
      url.protocol === "http:" &&
      !url.username &&
      !url.password &&
      (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function parseRecord(raw: string): RuntimeRecord | null {
  try {
    const r = JSON.parse(raw) as Partial<RuntimeRecord>;
    if (
      typeof r.instanceId !== "string" ||
      r.instanceId.length === 0 ||
      typeof r.pid !== "number" ||
      !Number.isInteger(r.pid) ||
      r.pid <= 0 ||
      typeof r.origin !== "string" ||
      !isLoopbackHttpOrigin(r.origin) ||
      (r.mode !== "desktop" && r.mode !== "standalone") ||
      typeof r.startedAt !== "number"
    ) {
      return null;
    }
    return r as RuntimeRecord;
  } catch {
    return null;
  }
}

function isDescriptor(value: unknown): value is ServerDescriptor {
  const d = value as Partial<ServerDescriptor> | null;
  return (
    d !== null &&
    typeof d === "object" &&
    d.product === "mailfast" &&
    d.protocolVersion === 1 &&
    typeof d.instanceId === "string" &&
    d.instanceId.length > 0 &&
    (d.mode === "desktop" || d.mode === "standalone") &&
    typeof d.origin === "string" &&
    isLoopbackHttpOrigin(d.origin)
  );
}

async function probeDescriptor(origin: string): Promise<ServerDescriptor | null> {
  try {
    const res = await fetch(`${origin}/.well-known/mailfast`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isDescriptor(data) ? data : null;
  } catch {
    return null;
  }
}

function defaultPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function portOf(origin: string): number | null {
  try {
    const port = Number(new URL(origin).port);
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
  } catch {
    return null;
  }
}

/**
 * Returns live Mailfast servers, desktop instances first (a desktop backend
 * is preferred for dev:web), then newest first. Stale records are removed.
 */
export async function discoverServers(runDir: string, deps: DiscoveryDeps = {}): Promise<DiscoveredServer[]> {
  const pidAlive = deps.pidAlive ?? defaultPidAlive;
  const probe = deps.probe ?? probeDescriptor;
  if (!existsSync(runDir)) return [];

  const found: DiscoveredServer[] = [];
  const seen = new Set<string>();
  for (const file of readdirSync(runDir)) {
    if (!file.endsWith(".json")) continue;
    const path = join(runDir, file);
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      // A server may exit and remove its record during discovery.
      continue;
    }
    const record = parseRecord(raw);
    const stale = () => {
      try {
        rmSync(path, { force: true });
      } catch {
        /* best effort */
      }
    };
    if (!record) {
      stale();
      continue;
    }
    if (!pidAlive(record.pid)) {
      stale();
      continue;
    }
    const descriptor = await probe(record.origin).catch(() => null);
    // Identity must match the record exactly; a live pid running something
    // else (PID reuse) or a different instance is not our server.
    if (!descriptor || descriptor.instanceId !== record.instanceId) {
      stale();
      continue;
    }
    const port = portOf(descriptor.origin) ?? portOf(record.origin);
    if (port === null || seen.has(`${descriptor.instanceId}:${port}`)) {
      if (port === null) stale();
      continue;
    }
    seen.add(`${descriptor.instanceId}:${port}`);
    found.push({
      instanceId: descriptor.instanceId,
      mode: descriptor.mode,
      origin: descriptor.origin,
      port,
      pid: record.pid,
      startedAt: record.startedAt,
    });
  }

  return found.sort((a, b) => Number(b.mode === "desktop") - Number(a.mode === "desktop") || b.startedAt - a.startedAt);
}
