import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { createConnection } from "node:net";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { discoverServers, type DiscoveredServer } from "@/service-discovery.ts";
import { env } from "@mailfast/env/server";

/**
 * Serial launcher behind `bun run dev:web` (and `dev:web:standalone`).
 *
 *  1. Discovers an already-running Mailfast server via ~/.mailfast/run records
 *     (pid liveness + /.well-known/mailfast identity). Desktop wins over
 *     standalone; nothing is ever killed or duplicated blindly.
 *  2. If none exists, starts a standalone server on a random port (port 0)
 *     using apps/server/.data, waits for READY, then points Vite's /api proxy
 *     at the real port via MAILFAST_PORT.
 *  3. If a Vite dev server already occupies :5199 it is reused only when its
 *     proxied /api/connection reports the same instanceId; otherwise this
 *     prints a restart instruction instead of fighting the user's process.
 *
 * `--standalone` skips desktop candidates: an independent standalone profile
 * is used even while the desktop app is running.
 */

const WEB_URL = new URL(env.MAILFAST_UI_ORIGINS.split(",")[0]!.trim()).origin;
const ROOT = resolve(import.meta.dir, "../../..");
const SERVER_DIR = resolve(import.meta.dir, "..");
const standaloneOnly = process.argv.includes("--standalone");
const runDir = env.MAILFAST_RUN_DIR ?? join(homedir(), ".mailfast", "run");

const spawned: ChildProcess[] = [];
const exitShutdown = new Map<ChildProcess, (code: number | null) => void>();
let webChild: ChildProcess | null = null;
let currentPort = 0;
let shuttingDown = false;

function log(msg: string) {
  console.log(`[dev:web] ${msg}`);
}

function killTree(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function shutdown(code: number): never {
  if (shuttingDown) process.exit(code);
  shuttingDown = true;
  for (const child of spawned) killTree(child);
  process.exit(code);
}

function fail(msg: string): never {
  console.error(`[dev:web] ${msg}`);
  shutdown(1);
}

interface WebStatus {
  kind: "absent" | "unknown" | "ok";
  instanceId?: string;
}

/** What does the Vite server on :5199 currently proxy /api to? */
async function webStatus(): Promise<WebStatus> {
  try {
    const res = await fetch(`${WEB_URL}/api/connection`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return { kind: "unknown" };
    const data = (await res.json().catch(() => null)) as { server?: { instanceId?: unknown } } | null;
    const instanceId = data?.server?.instanceId;
    return typeof instanceId === "string" ? { kind: "ok", instanceId } : { kind: "unknown" };
  } catch (error) {
    return { kind: error instanceof Error && error.name === "TimeoutError" ? "unknown" : "absent" };
  }
}

function spawnWeb(apiPort: number): ChildProcess {
  log(`starting Vite dev server on ${WEB_URL} (proxying /api to port ${apiPort})`);
  const child = spawn(
    "vp",
    ["dev", "--host", new URL(WEB_URL).hostname, "--port", new URL(WEB_URL).port || "80", "--strictPort"],
    {
      cwd: join(ROOT, "apps/web"),
      env: { ...process.env, MAILFAST_PORT: String(apiPort) },
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
  spawned.push(child);
  const onExit = (code: number | null) => {
    if (!shuttingDown) shutdown(code === 0 ? 0 : 1);
  };
  const listener = (code: number | null) => onExit(code);
  exitShutdown.set(child, listener);
  child.once("exit", listener);
  return child;
}

/** Kills a child we spawned on purpose (e.g. Vite restart), without shutdown. */
async function retireChild(child: ChildProcess) {
  const onExit = exitShutdown.get(child);
  if (onExit) child.off("exit", onExit);
  exitShutdown.delete(child);
  const i = spawned.indexOf(child);
  if (i >= 0) spawned.splice(i, 1);
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    child.once("exit", () => done());
    killTree(child);
  });
}

/** Check only the configured endpoint, including servers predating discovery. */
async function configuredPortOccupied(): Promise<boolean> {
  if (env.MAILFAST_PORT === 0) return false;
  return new Promise((done) => {
    const socket = createConnection({ host: "127.0.0.1", port: env.MAILFAST_PORT });
    const finish = (occupied: boolean) => {
      socket.destroy();
      done(occupied);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1500, () => finish(true));
  });
}

function spawnServer(): ChildProcess {
  log(`starting standalone mail server on a random port (data: ${env.MAILFAST_DATA_DIR ?? join(SERVER_DIR, ".data")})`);
  return spawn("bun", ["--watch", "src/index.ts"], {
    cwd: SERVER_DIR,
    env: { ...process.env, MAILFAST_PORT: "0", MAILFAST_SERVER_MODE: "standalone" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

interface ServerReady {
  port: number;
  instanceId: string;
  origin: string;
}

/** Reads READY/PAIRING lines; reports each READY, forwards PAIRING as pair URLs. */
function watchServerOutput(
  child: ChildProcess,
  onReady: (ready: ServerReady) => void,
  onExit: (code: number | null) => void,
) {
  child.once("exit", (code) => onExit(code));
  child.once("error", () => onExit(null));
  createInterface({ input: child.stdout! }).on("line", (line) => {
    if (line.startsWith("READY ")) {
      try {
        onReady(JSON.parse(line.slice(6)) as ServerReady);
      } catch {
        /* malformed */
      }
    } else if (line.startsWith("PAIRING ")) {
      try {
        const grant = JSON.parse(line.slice(8)) as { code?: string; url?: string };
        const url = grant.url ?? `${WEB_URL}/#pair=${grant.code ?? ""}`;
        log(`open this URL in your browser to pair it: ${url}`);
      } catch {
        /* malformed */
      }
    } else {
      console.log(`[server] ${line}`);
    }
  });
  createInterface({ input: child.stderr! }).on("line", (line) => console.error(`[server] ${line}`));
}

/**
 * Ensures Vite on :5199 proxies to `instanceId`. Returns true when Vite had
 * to be (re)started by us; false when an existing correct Vite was reused.
 */
async function ensureWeb(instanceId: string, apiPort: number): Promise<boolean> {
  const status = await webStatus();
  if (status.kind === "ok") {
    if (status.instanceId === instanceId) {
      log(`Vite already proxies to this server — reusing ${WEB_URL}`);
      return false;
    }
    fail(
      `Vite on ${WEB_URL} is proxying /api to a different Mailfast instance. ` +
        `Restart it so it picks up MAILFAST_PORT=${apiPort}: stop the Vite process and run \`bun run dev:web\` again.`,
    );
  }
  if (status.kind === "unknown") {
    fail(
      `Something is on ${WEB_URL} but its /api proxy does not reach a Mailfast server. ` +
        `Restart Vite with MAILFAST_PORT=${apiPort}: stop it and run \`bun run dev:web\` again.`,
    );
  }
  webChild = spawnWeb(apiPort);
  return true;
}

function waitForExit(): Promise<void> {
  return new Promise((resolveWait) => {
    const done = () => resolveWait();
    for (const child of spawned) child.once("exit", done);
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

async function main() {
  const candidates = await discoverServers(runDir);
  const existing: DiscoveredServer | undefined = standaloneOnly
    ? candidates.find((c) => c.mode === "standalone")
    : candidates[0];

  if (existing) {
    log(`reusing running ${existing.mode} server instance ${existing.instanceId.slice(0, 8)}… at ${existing.origin}`);
    const started = await ensureWeb(existing.instanceId, existing.port);
    if (!started) {
      log(`Mailfast is already fully running — open ${WEB_URL}`);
      return;
    }
  } else {
    if ((await webStatus()).kind !== "absent") {
      fail(
        `An existing UI on ${WEB_URL} has no matching discovered server. Restart that UI and its server before launching Mailfast.`,
      );
    }
    if (!candidates.some((candidate) => candidate.port === env.MAILFAST_PORT) && (await configuredPortOccupied())) {
      fail(
        `Port ${env.MAILFAST_PORT} is occupied by an undiscovered service. Stop or restart the older service before launching Mailfast so two servers cannot sync the same mailbox.`,
      );
    }
    if (standaloneOnly) log("no standalone server found; starting an independent one");
    const server = spawnServer();
    spawned.push(server);
    watchServerOutput(
      server,
      (ready) => {
        void (async () => {
          try {
            // --watch reloads rebind a new port: restart our Vite with the new target.
            if (webChild && currentPort !== ready.port) {
              const old = webChild;
              webChild = null;
              await retireChild(old);
            }
            currentPort = ready.port;
            await ensureWeb(ready.instanceId, ready.port);
          } catch (err) {
            console.error(`[dev:web] ${err instanceof Error ? err.message : String(err)}`);
            shutdown(1);
          }
        })();
      },
      () => {
        if (!shuttingDown) {
          console.error("[dev:web] mail server exited; stopping");
          shutdown(1);
        }
      },
    );
  }

  await waitForExit();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

try {
  await main();
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
