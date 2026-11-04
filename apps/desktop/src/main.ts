import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { BrowserWindow, app, dialog, ipcMain, safeStorage, session, shell } from "electron";
import { AUTH_HEADER } from "@mailfast/shared";

/**
 * Electron main process.
 *  1. Starts the Bun sidecar (local HTTP API: Gmail, SQLite, OAuth, sync).
 *  2. Waits for its `READY {port}` line on stdout.
 *  3. Injects the per-launch API token into /api requests at the network
 *     layer, so renderer code never sees it (same idea as opencode).
 *  4. Loads the UI: the Vite dev server in development, the sidecar itself
 *     (serving the prerendered TanStack Start SPA) in production.
 */
const isDev = !app.isPackaged;
const DEV_URL = process.env.MAILFAST_DEV_URL ?? "http://localhost:5199";
const DEV_API_PORT = process.env.MAILFAST_PORT ?? "47821";

let win: BrowserWindow | null = null;
let server: ChildProcess | null = null;
let apiOrigin = "";
let quitting = false;
const apiToken = randomBytes(32).toString("hex");

if (!app.requestSingleInstanceLock()) app.quit();

/** Better Auth secret (encrypts stored OAuth tokens), protected by the OS keychain via safeStorage. */
async function secretKey(): Promise<string | undefined> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return undefined;
  const file = join(app.getPath("userData"), "secret.key");
  if (existsSync(file)) {
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(readFileSync(file));
      if (shouldReEncrypt) writeFileSync(file, await safeStorage.encryptStringAsync(result));
      return result;
    } catch {
      /* keychain changed: generate a new key (stored tokens become unreadable; user signs in again) */
    }
  }
  const key = randomBytes(32).toString("hex");
  writeFileSync(file, await safeStorage.encryptStringAsync(key));
  return key;
}

async function serverCommand(): Promise<{ cmd: string; args: string[]; env: Record<string, string> }> {
  const dataDir = join(app.getPath("userData"), "data");
  mkdirSync(dataDir, { recursive: true });
  const env: Record<string, string> = {
    MAILFAST_TOKEN: apiToken,
    MAILFAST_DATA_DIR: dataDir,
    MAILFAST_PARENT_PID: String(process.pid),
  };
  const key = await secretKey();
  if (key) env.MAILFAST_SECRET_KEY = key;

  if (isDev) {
    // Fixed port so Vite can proxy /api to it.
    env.MAILFAST_PORT = DEV_API_PORT;
    return { cmd: "bun", args: ["run", resolve(__dirname, "../../server/src/index.ts")], env };
  }
  const exe = process.platform === "win32" ? "mailfast-server.exe" : "mailfast-server";
  env.MAILFAST_STATIC_DIR = join(process.resourcesPath, "web");
  env.MAILFAST_MIGRATIONS_DIR = join(process.resourcesPath, "migrations");
  return { cmd: join(process.resourcesPath, "server", exe), args: [], env };
}

async function startServer(): Promise<number> {
  const { cmd, args, env } = await serverCommand();
  const child = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server = child;

  let ready = false;
  return new Promise((resolvePort, reject) => {
    const timeout = setTimeout(() => reject(new Error("Mailfast service did not start within 20s")), 20_000);
    createInterface({ input: child.stdout! }).on("line", (line) => {
      if (line.startsWith("READY ")) {
        ready = true;
        clearTimeout(timeout);
        resolvePort((JSON.parse(line.slice(6)) as { port: number }).port);
      } else console.log(`[server] ${line}`);
    });
    createInterface({ input: child.stderr! }).on("line", (line) => console.error(`[server] ${line}`));
    child.once("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      server = null;
      if (quitting) return;
      if (!ready) return reject(new Error(`Mailfast service exited during startup (code ${code})`));
      // Crashed after a good start: bring it back and reload the window on the new port.
      console.error(`[server] exited with ${code}; restarting`);
      setTimeout(() => void boot().catch(fatal), 1000);
    });
  });
}

let headerHookInstalled = false;
function installAuthHeader() {
  if (headerHookInstalled) return;
  headerHookInstalled = true;
  // In dev the renderer calls Vite (which proxies /api); in prod it calls the sidecar directly.
  const urls = isDev ? [`${DEV_URL}/api/*`] : ["http://127.0.0.1/api/*", "http://127.0.0.1:*/api/*"];
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
    if (isDev || details.url.startsWith(apiOrigin)) details.requestHeaders[AUTH_HEADER] = apiToken;
    callback({ requestHeaders: details.requestHeaders });
  });
}

async function waitForDevServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(DEV_URL);
      if (res.ok || res.status === 404) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Vite dev server not reachable at ${DEV_URL}. Run \`vp run dev\` from the repo root.`);
}

function createWindow(url: string) {
  if (win) {
    void win.loadURL(url);
    return;
  }
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 480,
    show: false,
    backgroundColor: "#0f1115",
    title: "Mailfast",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => (win = null));

  // Links leaving the app open in the system browser.
  const appOrigin = new URL(url).origin;
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith("https://")) void shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, target) => {
    if (new URL(target).origin !== appOrigin) {
      e.preventDefault();
      if (target.startsWith("https://")) void shell.openExternal(target);
    }
  });
  void win.loadURL(url);
}

async function boot() {
  const port = await startServer();
  apiOrigin = `http://127.0.0.1:${port}`;
  installAuthHeader();
  if (isDev) await waitForDevServer();
  createWindow(isDev ? DEV_URL : `${apiOrigin}/`);
}

function fatal(err: unknown) {
  if (quitting) return;
  dialog.showErrorBox("Mailfast could not start", err instanceof Error ? err.message : String(err));
  app.quit();
}

ipcMain.on("open-external", (_e, url: unknown) => {
  if (typeof url === "string" && url.startsWith("https://")) void shell.openExternal(url);
});

app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on("browser-window-focus", () => {
  // Window focus is a good moment to check for new mail.
  if (apiOrigin)
    void fetch(`${apiOrigin}/api/sync`, { method: "POST", headers: { [AUTH_HEADER]: apiToken } }).catch(() => {});
});

void app.whenReady().then(() => boot().catch(fatal));

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (!win && apiOrigin) createWindow(isDev ? DEV_URL : `${apiOrigin}/`);
});
app.on("before-quit", () => {
  quitting = true;
  server?.kill();
});
