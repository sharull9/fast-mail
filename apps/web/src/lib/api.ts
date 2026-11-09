import { cachedContacts, cacheContacts } from "@/lib/contact-cache";
import type {
  AccountSettings,
  ContactPage,
  SaveContact,
  ManagedContact,
  AuthStatus,
  ConnectionStatus,
  Contact,
  Label,
  ListThreadsResponse,
  ThreadDateRange,
  MailAccount,
  PairingGrant,
  PairedBrowser,
  SendMessageRequest,
  SendMessageResponse,
  SyncStatus,
  ThreadAction,
  ThreadDetail,
  MailExportRequest,
  MailImportResult,
  ChatSpace,
  ChatMessage,
  QuotedMessage,
  CreateSpaceRequest,
  ListChatSpacesResponse,
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
  accountSettings: (accountId = activeAccountId) =>
    call<AccountSettings>("/settings/account", { headers: accountHeaders(accountId) }),
  saveAccountSettings: (value: AccountSettings, accountId = activeAccountId) =>
    call<AccountSettings>("/settings/account", { method: "PUT", json: value, headers: accountHeaders(accountId) }),
  managedContacts: (
    opts: { q: string; hidden: boolean; offset: number; limit: number },
    accountId = activeAccountId,
  ) => {
    const params = new URLSearchParams({
      q: opts.q,
      hidden: String(opts.hidden),
      offset: String(opts.offset),
      limit: String(opts.limit),
    });
    return call<ContactPage>(`/settings/contacts?${params}`, { headers: accountHeaders(accountId) });
  },
  saveContact: (value: SaveContact, accountId = activeAccountId) =>
    call<ManagedContact>("/settings/contacts", { json: value, headers: accountHeaders(accountId) }),
  setContactHidden: (email: string, hidden: boolean, accountId = activeAccountId) =>
    call<{ ok: true }>("/settings/contacts", {
      method: "PATCH",
      json: { email, hidden },
      headers: accountHeaders(accountId),
    }),
  importContacts: (contacts: Contact[], accountId = activeAccountId) =>
    call<{ imported: number }>("/settings/contacts/import", { json: { contacts }, headers: accountHeaders(accountId) }),

  importMail: (file: File, accountId = activeAccountId) =>
    call<MailImportResult>(`/mail/import?format=${file.name.toLowerCase().endsWith(".mbox") ? "mbox" : "eml"}`, {
      method: "POST",
      body: file,
      headers: accountHeaders(accountId),
    }),
  exportMail: async (selection: MailExportRequest, accountId = activeAccountId) => {
    requirePaired();
    const res = await request("/mail/export", { json: selection, headers: accountHeaders(accountId) });
    if (!res.ok) return throwResponseError(res);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mailfast.${"messageId" in selection ? "eml" : "mbox"}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
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
  sendMessage: (data: SendMessageRequest, accountId = activeAccountId) =>
    call<SendMessageResponse>("/messages/send", { json: data, headers: accountHeaders(accountId) }),
  contacts: async (q = "", limit = 20, signal?: AbortSignal, accountId = activeAccountId): Promise<Contact[]> => {
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      params.set("limit", String(limit));
      const remote = await call<Contact[]>(`/contacts?${params.toString()}`, {
        signal,
        headers: accountHeaders(accountId),
      });
      if (signal?.aborted) return [];
      cacheContacts(accountId, remote, q);
      return remote;
    } catch (error) {
      if (signal?.aborted || error instanceof ApiError) throw error;
      const search = q.trim().toLowerCase();
      return cachedContacts(accountId)
        .filter((value) => `${value.name} ${value.email}`.toLowerCase().includes(search))
        .slice(0, limit);
    }
  },
  chatSpaces: (accountId = activeAccountId) =>
    call<ListChatSpacesResponse>("/chat/spaces", { headers: accountHeaders(accountId) }),
  createMeetLink: (accountId = activeAccountId) =>
    call<{ meetingUri: string }>("/chat/meet", { method: "POST", headers: accountHeaders(accountId) }),
  createChatSpace: (body: CreateSpaceRequest, accountId = activeAccountId) =>
    call<ChatSpace>("/chat/spaces", { method: "POST", json: body, headers: accountHeaders(accountId) }),
  chatMessages: (spaceId: string, accountId = activeAccountId) =>
    call<{ messages: ChatMessage[] }>(`/chat/messages?spaceId=${encodeURIComponent(spaceId)}`, {
      headers: accountHeaders(accountId),
    }),
  sendChatMessage: (
    spaceId: string,
    text: string,
    threadId?: string,
    quotedMessage?: QuotedMessage,
    accountId = activeAccountId,
  ) =>
    call<ChatMessage>("/chat/messages", {
      method: "POST",
      json: { spaceId, text, threadId, quotedMessage },
      headers: accountHeaders(accountId),
    }),
  markChatSpaceRead: (spaceId: string, accountId = activeAccountId) =>
    call<{ ok: true }>("/chat/spaces/read", {
      method: "POST",
      json: { spaceId },
      headers: accountHeaders(accountId),
    }),
  attachmentTicket: (params: { messageId: string; attachmentId: string; filename?: string; mimeType?: string }) =>
    call<{ ticket: string; url: string }>("/attachment-ticket", { json: params }),
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

export function getAttachmentUrl(
  messageId: string,
  attachmentId: string,
  filename?: string,
  mimeType?: string,
): string {
  const params = new URLSearchParams();
  if (filename) params.set("filename", filename);
  if (mimeType) params.set("mimeType", mimeType);
  const q = params.toString() ? `?${params}` : "";
  return `/api/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}${q}`;
}

export async function fetchAttachmentBlob(
  messageId: string,
  attachmentId: string,
  filename?: string,
  mimeType?: string,
): Promise<Blob> {
  const path = `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
  const params = new URLSearchParams();
  if (filename) params.set("filename", filename);
  if (mimeType) params.set("mimeType", mimeType);
  const q = params.toString() ? `?${params}` : "";
  const res = await request(`${path}${q}`);
  if (!res.ok) {
    await throwResponseError(res);
  }
  return res.blob();
}

export async function downloadAttachment(messageId: string, attachmentId: string, filename: string, mimeType?: string) {
  const blob = await fetchAttachmentBlob(messageId, attachmentId, filename, mimeType);
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename || "attachment";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 2000);
}

export async function openAttachmentInBrowser(
  messageId: string,
  attachmentId: string,
  filename: string,
  mimeType?: string,
) {
  if (isDesktopApp()) {
    try {
      const res = await api.attachmentTicket({ messageId, attachmentId, filename, mimeType });
      openExternal(res.url);
    } catch {
      const blob = await fetchAttachmentBlob(messageId, attachmentId, filename, mimeType);
      const blobUrl = URL.createObjectURL(blob);
      openExternal(blobUrl);
    }
  } else {
    const url = getAttachmentUrl(messageId, attachmentId, filename, mimeType);
    window.open(url, "_blank", "noopener");
  }
}

function accountHeaders(id: string | null): HeadersInit {
  return id ? { "x-mailfast-account": id } : {};
}
