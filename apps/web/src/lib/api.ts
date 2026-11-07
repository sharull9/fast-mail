import type {
  AuthStatus,
  ConnectionStatus,
  Label,
  ListThreadsResponse,
  ThreadDateRange,
  MailAccount,
  PairingGrant,
  PairedBrowser,
  SyncStatus,
  ThreadAction,
  ThreadDetail,
} from "@mailfast/shared";

/**
 * Same-origin calls to the Bun sidecar. Electron injects the API token at the
 * network layer; paired browsers use an HttpOnly session cookie.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const UI_BOOTSTRAP_HEADER = "x-mailfast-ui";
let serverPaired = false;
let requiresPairing = false;

let activeAccountId: string | null =
  typeof window === "undefined" ? null : localStorage.getItem("mailfast.active-account");

export function getActiveAccountId() {
  return activeAccountId;
}
export function setActiveAccountId(id: string | null) {
  activeAccountId = id;
  if (typeof window !== "undefined") {
    if (id) localStorage.setItem("mailfast.active-account", id);
    else localStorage.removeItem("mailfast.active-account");
  }
}

/** Older sidecars and fixtures expose only the active email. */
export function normalizeAuthStatus(status: AuthStatus): AuthStatus {
  const accounts: MailAccount[] =
    status.accounts ??
    (status.account ? [{ id: status.account, email: status.account, name: null, image: null, unread: 0 }] : []);
  return { ...status, accounts, activeAccountId: status.activeAccountId ?? accounts[0]?.id ?? null };
}

function request(path: string, init?: RequestInit & { json?: unknown }): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("x-mailfast-account") && activeAccountId) headers.set("x-mailfast-account", activeAccountId);
  if (init?.json !== undefined) headers.set("content-type", "application/json");
  return fetch(`/api${path}`, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
}

async function throwResponseError(res: Response): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
}

function requirePaired() {
  if (!serverPaired || requiresPairing) {
    throw new ApiError(401, "Pair this browser with the Mailfast server before accessing mail");
  }
}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  requirePaired();
  const res = await request(path, init);
  if (res.status === 401) {
    requiresPairing = true;
    serverPaired = false;
    if (typeof window !== "undefined") window.dispatchEvent(new Event("mailfast:session-invalid"));
  }
  if (!res.ok) return throwResponseError(res);
  return (await res.json()) as T;
}

export const api = {
  connection: async () => {
    const res = await request("/connection");
    if (!res.ok) return throwResponseError(res);
    const status = (await res.json()) as ConnectionStatus;
    serverPaired = status.paired;
    return { ...status, paired: status.paired && !requiresPairing };
  },
  exchangePairingCode: async (code: string) => {
    const res = await request("/session", {
      method: "POST",
      headers: { [UI_BOOTSTRAP_HEADER]: "1" },
      json: { code },
    });
    if (!res.ok) return throwResponseError(res);
    requiresPairing = false;
    serverPaired = true;
  },
  disconnectBrowser: async () => {
    requirePaired();
    const res = await request("/session", { method: "DELETE" });
    if (!res.ok) {
      if (res.status === 401) {
        requiresPairing = true;
        serverPaired = false;
        if (typeof window !== "undefined") window.dispatchEvent(new Event("mailfast:session-invalid"));
      }
      return throwResponseError(res);
    }
    requiresPairing = true;
    serverPaired = false;
    if (typeof window !== "undefined") window.dispatchEvent(new Event("mailfast:session-invalid"));
  },
  createPairingGrant: () => call<PairingGrant>("/pairing-grants", { json: {} }),
  browserSessions: () => call<PairedBrowser[]>("/browser-sessions"),
  revokeBrowserSession: (id: string) =>
    call<{ ok: true }>(`/browser-sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  authStatus: async (signal?: AbortSignal) => normalizeAuthStatus(await call<AuthStatus>("/auth/status", { signal })),
  setActiveAccount: async (id: string) =>
    normalizeAuthStatus(await call<AuthStatus>("/accounts/active", { json: { id } })),
  logoutAccount: async (id: string) =>
    normalizeAuthStatus(await call<AuthStatus>(`/accounts/${encodeURIComponent(id)}/logout`, { json: {} })),
  events: (signal: AbortSignal) => {
    requirePaired();
    return request("/events", { signal });
  },
  saveClient: (clientId: string, clientSecret: string) =>
    call<AuthStatus>("/auth/config", { json: { clientId, clientSecret } }),
  login: () => call<{ url: string }>("/auth/login", { json: {} }),
  logout: () => call<AuthStatus>("/auth/logout", { json: {} }),

  status: (accountId = activeAccountId) => call<SyncStatus>("/status", { headers: accountHeaders(accountId) }),
  syncNow: () => call<{ ok: true }>("/sync", { json: {} }),

  labels: (signal?: AbortSignal, accountId = activeAccountId) =>
    call<Label[]>("/labels", { signal, headers: accountHeaders(accountId) }),
  threads: (
    labelId: string,
    limit: number,
    signal?: AbortSignal,
    accountId = activeAccountId,
    range: ThreadDateRange = {},
  ) => {
    const params = new URLSearchParams({ label: labelId, limit: String(limit) });
    if (range.after !== undefined) params.set("after", String(range.after));
    if (range.before !== undefined) params.set("before", String(range.before));
    return call<ListThreadsResponse>(`/threads?${params}`, { signal, headers: accountHeaders(accountId) });
  },
  thread: (id: string, signal?: AbortSignal, accountId = activeAccountId) =>
    call<ThreadDetail>(`/threads/${encodeURIComponent(id)}`, { signal, headers: accountHeaders(accountId) }),
  search: (q: string, signal?: AbortSignal, accountId = activeAccountId) =>
    call<ListThreadsResponse>(`/search?q=${encodeURIComponent(q)}`, { signal, headers: accountHeaders(accountId) }),
  act: (threadIds: string[], action: ThreadAction, accountId = activeAccountId) =>
    call<unknown>("/threads/actions", { json: { threadIds, action }, headers: accountHeaders(accountId) }),
  prefetch: (hint: { threadIds?: string[]; labelIds?: string[] }) =>
    call<{ ok: true }>("/prefetch", { json: hint }).catch(() => undefined),
};

/** True when running inside Electron's preload bridge, not a plain browser tab. */
export function isDesktopApp() {
  return typeof window !== "undefined" && Boolean((window as { mailfast?: unknown }).mailfast);
}

/** Opens a URL in the system browser (Electron) or a new tab (plain browser). */
export function openExternal(url: string) {
  const bridge = (window as { mailfast?: { openExternal(url: string): void } }).mailfast;
  if (bridge) bridge.openExternal(url);
  else window.open(url, "_blank", "noopener");
}

function accountHeaders(id: string | null): HeadersInit {
  return id ? { "x-mailfast-account": id } : {};
}
