import type {
  AuthStatus,
  ConnectionStatus,
  Label,
  ListThreadsResponse,
  PairingGrant,
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

function request(path: string, init?: RequestInit & { json?: unknown }): Promise<Response> {
  const headers = new Headers(init?.headers);
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
  authStatus: () => call<AuthStatus>("/auth/status"),
  saveClient: (clientId: string, clientSecret: string) =>
    call<AuthStatus>("/auth/config", { json: { clientId, clientSecret } }),
  login: () => call<{ url: string }>("/auth/login", { json: {} }),
  logout: () => call<AuthStatus>("/auth/logout", { json: {} }),

  status: () => call<SyncStatus>("/status"),
  syncNow: () => call<{ ok: true }>("/sync", { json: {} }),

  labels: (signal?: AbortSignal) => call<Label[]>("/labels", { signal }),
  threads: (labelId: string, limit: number, signal?: AbortSignal) =>
    call<ListThreadsResponse>(`/threads?label=${encodeURIComponent(labelId)}&limit=${limit}`, { signal }),
  thread: (id: string, signal?: AbortSignal) => call<ThreadDetail>(`/threads/${encodeURIComponent(id)}`, { signal }),
  search: (q: string, signal?: AbortSignal) =>
    call<ListThreadsResponse>(`/search?q=${encodeURIComponent(q)}`, { signal }),
  act: (threadIds: string[], action: ThreadAction) =>
    call<unknown>("/threads/actions", { json: { threadIds, action } }),
  prefetch: (hint: { threadIds?: string[]; labelIds?: string[] }) =>
    call<{ ok: true }>("/prefetch", { json: hint }).catch(() => undefined),
};

/** Opens a URL in the system browser (Electron) or a new tab (plain browser). */
export function openExternal(url: string) {
  const bridge = (window as { mailfast?: { openExternal(url: string): void } }).mailfast;
  if (bridge) bridge.openExternal(url);
  else window.open(url, "_blank", "noopener");
}
