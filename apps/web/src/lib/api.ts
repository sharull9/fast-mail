import type { AuthStatus, Label, ListThreadsResponse, SyncStatus, ThreadAction, ThreadDetail } from "@mailfast/shared";

/**
 * Same-origin calls to the Bun sidecar. The auth header is injected by
 * Electron's main process, so the renderer never sees the API token.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: init?.json !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const api = {
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
