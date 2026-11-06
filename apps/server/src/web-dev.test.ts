import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function launch(runDir: string, uiOrigin: string, port = 0) {
  const child = spawn(process.execPath, [join(import.meta.dir, "web-dev.ts")], {
    env: {
      ...process.env,
      NODE_ENV: "test",
      MAILFAST_RUN_DIR: runDir,
      MAILFAST_DATA_DIR: join(runDir, "data"),
      MAILFAST_UI_ORIGINS: uiOrigin,
      MAILFAST_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    output += String(chunk);
  });
  const code = await new Promise<number | null>((done, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("launcher did not exit"));
    }, 5000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      done(code);
    });
  });
  return { code, output };
}

test("launcher reuses a positively identified server and UI without creating a mailbox", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mailfast-launcher-"));
  const instanceId = crypto.randomUUID();
  let origin = "";
  const api = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      Response.json({
        product: "mailfast",
        protocolVersion: 1,
        instanceId,
        mode: "desktop",
        origin,
      }),
  });
  origin = `http://127.0.0.1:${api.port}`;
  const ui = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => Response.json({ server: { instanceId }, paired: false }),
  });
  try {
    writeFileSync(
      join(dir, `${instanceId}.json`),
      JSON.stringify({ instanceId, pid: process.pid, origin, mode: "desktop", startedAt: Date.now() }),
    );
    const result = await launch(dir, `http://127.0.0.1:${ui.port}`);
    expect(result.code).toBe(0);
    expect(result.output).toContain("reusing running desktop");
    expect(existsSync(join(dir, "data"))).toBe(false);
  } finally {
    await api.stop(true);
    await ui.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("launcher refuses unknown UI or legacy API occupants before touching mailbox data", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mailfast-launcher-"));
  const occupied = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("unknown") });
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  const freeOrigin = `http://127.0.0.1:${reservation.port}`;
  await reservation.stop(true);
  try {
    mkdirSync(join(dir, "run"));
    const unknownUi = await launch(join(dir, "run"), `http://127.0.0.1:${occupied.port}`);
    expect(unknownUi.code).toBe(1);
    expect(unknownUi.output).toContain("no matching discovered server");
    const legacyApi = await launch(join(dir, "run"), freeOrigin, occupied.port!);
    expect(legacyApi.code).toBe(1);
    expect(legacyApi.output).toContain("undiscovered service");
    expect(existsSync(join(dir, "run/data"))).toBe(false);
  } finally {
    await occupied.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});
