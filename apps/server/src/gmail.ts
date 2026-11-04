import type { MessageInput } from "@mailfast/db";
import type { Label } from "@mailfast/shared";
import type { Auth } from "./auth.ts";
import { Limiter, Priority } from "./limiter.ts";

/**
 * Thin Gmail REST client tuned for speed:
 *  - field masks so responses only carry metadata we store
 *  - batch endpoint (up to 40 sub-requests per HTTP call) for message metadata
 *  - shared priority token bucket for the 250 units/s per-user quota
 *  - retry with backoff on 429 / 5xx, single retry on 401 after refresh
 */
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const BATCH_URL = "https://gmail.googleapis.com/batch/gmail/v1";
const BATCH_SIZE = 40;

const META_HEADERS = ["From", "To", "Cc", "Subject"];
const MESSAGE_FIELDS = "id,threadId,labelIds,snippet,internalDate,payload/headers";
const META_QUERY =
  "format=metadata&" +
  META_HEADERS.map((h) => `metadataHeaders=${h}`).join("&") +
  `&fields=${encodeURIComponent(MESSAGE_FIELDS)}`;

// Quota units per method (developers.google.com/gmail/api/reference/quota).
const UNITS = { get: 5, list: 5, threadGet: 10, history: 2, labels: 1, labelGet: 1, modify: 10, trash: 10, profile: 1 };

export class GmailError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface RawMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

export interface HistoryPage {
  history?: {
    messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[];
    messagesDeleted?: { message: { id: string; threadId: string } }[];
    labelsAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[];
    labelsRemoved?: { message: { id: string; threadId: string; labelIds?: string[] } }[];
  }[];
  historyId: string;
  nextPageToken?: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** Gmail snippets are HTML-escaped. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** `"Alice B" <alice@x.com>` -> { name: "Alice B", email: "alice@x.com" } */
export function parseAddress(value: string): { name: string; email: string } {
  const m = value.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
  if (m) return { name: (m[1] ?? "").trim(), email: m[2]!.trim() };
  const email = value.trim();
  return { name: "", email };
}

export function toMessageInput(raw: RawMessage): MessageInput {
  const headers = new Map<string, string>();
  for (const h of raw.payload?.headers ?? []) {
    const key = h.name.toLowerCase();
    if (!headers.has(key)) headers.set(key, h.value);
  }
  const from = parseAddress(headers.get("from") ?? "");
  return {
    id: raw.id,
    threadId: raw.threadId,
    date: Number(raw.internalDate ?? 0),
    fromName: from.name,
    fromEmail: from.email,
    to: headers.get("to") ?? "",
    cc: headers.get("cc") ?? "",
    subject: headers.get("subject") ?? "",
    snippet: decodeEntities(raw.snippet ?? ""),
    labelIds: raw.labelIds ?? [],
  };
}

/** Parses a multipart/mixed batch response into (content-id -> {status, body}). */
export function parseBatchResponse(text: string, boundary: string): Map<string, { status: number; body: string }> {
  const out = new Map<string, { status: number; body: string }>();
  for (const part of text.split(`--${boundary}`)) {
    const id = part.match(/Content-ID:\s*<response-([^>]+)>/i)?.[1];
    const statusMatch = part.match(/HTTP\/[\d.]+ (\d{3})/);
    if (!id || !statusMatch) continue;
    const afterStatus = part.indexOf("\n", statusMatch.index!);
    const sep = part.slice(afterStatus).search(/\r?\n\r?\n/);
    const body = sep >= 0 ? part.slice(afterStatus + sep).trim() : "";
    out.set(id, { status: Number(statusMatch[1]), body });
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Gmail {
  readonly limiter = new Limiter(230, 250);

  constructor(private readonly auth: Auth) {}

  private async request<T>(
    path: string,
    opts: { method?: string; query?: string; body?: unknown; units: number; priority: Priority },
  ): Promise<T> {
    let attempt = 0;
    for (;;) {
      await this.limiter.acquire(opts.units, opts.priority);
      const token = await this.auth.token();
      const url = `${path.startsWith("http") ? path : API + path}${opts.query ? `?${opts.query}` : ""}`;
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "accept-encoding": "gzip",
          ...(opts.body ? { "content-type": "application/json" } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;

      const text = await res.text();
      if (res.status === 401 && attempt === 0) {
        this.auth.invalidate();
        attempt++;
        continue;
      }
      const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimit/i.test(text));
      if (retryable && attempt < 6) {
        const retryAfter = Number(res.headers.get("retry-after")) * 1000;
        const wait = retryAfter > 0 ? retryAfter : Math.min(32_000, 500 * 2 ** attempt) + Math.random() * 250;
        if (res.status === 429 || res.status === 403) this.limiter.penalize(wait);
        await sleep(wait);
        attempt++;
        continue;
      }
      throw new GmailError(res.status, `${opts.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    }
  }

  profile(token?: string) {
    if (token) {
      // Used during sign-in before the refresh token is stored.
      return fetch(`${API}/profile?fields=emailAddress,historyId`, {
        headers: { authorization: `Bearer ${token}` },
      }).then(async (r) => {
        if (!r.ok) throw new GmailError(r.status, await r.text());
        return (await r.json()) as { emailAddress: string; historyId: string };
      });
    }
    return this.request<{ emailAddress: string; historyId: string }>("/profile", {
      query: "fields=emailAddress,historyId",
      units: UNITS.profile,
      priority: Priority.Realtime,
    });
  }

  async labels(): Promise<Label[]> {
    const res = await this.request<{
      labels: { id: string; name: string; type: string; color?: { backgroundColor?: string } }[];
    }>("/labels", { query: "fields=labels(id,name,type,color)", units: UNITS.labels, priority: Priority.Realtime });
    return res.labels.map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type === "system" ? "system" : "user",
      color: l.color?.backgroundColor ?? null,
      unread: 0,
      total: 0,
    }));
  }

  labelCounts(id: string, priority: Priority = Priority.Background) {
    return this.request<{ threadsUnread?: number; threadsTotal?: number }>(`/labels/${encodeURIComponent(id)}`, {
      query: "fields=threadsUnread,threadsTotal",
      units: UNITS.labelGet,
      priority,
    });
  }

  listMessageIds(
    opts: { labelId?: string; q?: string; pageToken?: string; maxResults: number; includeSpamTrash?: boolean },
    priority: Priority,
  ) {
    const p = new URLSearchParams({
      maxResults: String(opts.maxResults),
      fields: "messages(id,threadId),nextPageToken",
    });
    if (opts.labelId) p.set("labelIds", opts.labelId);
    if (opts.q) p.set("q", opts.q);
    if (opts.pageToken) p.set("pageToken", opts.pageToken);
    if (opts.includeSpamTrash) p.set("includeSpamTrash", "true");
    return this.request<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>("/messages", {
      query: p.toString(),
      units: UNITS.list,
      priority,
    });
  }

  async thread(threadId: string, priority: Priority): Promise<MessageInput[]> {
    const fields = encodeURIComponent(`messages(${MESSAGE_FIELDS})`);
    const res = await this.request<{ messages?: RawMessage[] }>(`/threads/${encodeURIComponent(threadId)}`, {
      query: "format=metadata&" + META_HEADERS.map((h) => `metadataHeaders=${h}`).join("&") + `&fields=${fields}`,
      units: UNITS.threadGet,
      priority,
    });
    return (res.messages ?? []).map(toMessageInput);
  }

  history(startHistoryId: string, pageToken?: string) {
    const p = new URLSearchParams({ startHistoryId, maxResults: "500" });
    for (const t of ["messageAdded", "messageDeleted", "labelAdded", "labelRemoved"]) p.append("historyTypes", t);
    p.set(
      "fields",
      "history(messagesAdded/message(id,threadId,labelIds),messagesDeleted/message(id,threadId),labelsAdded/message(id,threadId,labelIds),labelsRemoved/message(id,threadId,labelIds)),historyId,nextPageToken",
    );
    if (pageToken) p.set("pageToken", pageToken);
    return this.request<HistoryPage>("/history", {
      query: p.toString(),
      units: UNITS.history,
      priority: Priority.Realtime,
    });
  }

  modifyThread(threadId: string, add: string[], remove: string[]) {
    return this.request(`/threads/${encodeURIComponent(threadId)}/modify`, {
      method: "POST",
      body: { addLabelIds: add, removeLabelIds: remove },
      query: "fields=id",
      units: UNITS.modify,
      priority: Priority.Interactive,
    });
  }

  trashThread(threadId: string, untrash = false) {
    return this.request(`/threads/${encodeURIComponent(threadId)}/${untrash ? "untrash" : "trash"}`, {
      method: "POST",
      query: "fields=id",
      units: UNITS.trash,
      priority: Priority.Interactive,
    });
  }

  /**
   * Fetches metadata for many messages through the batch endpoint.
   * Missing (404) ids are reported in `gone`; transient failures are retried.
   */
  async messages(ids: string[], priority: Priority): Promise<{ messages: MessageInput[]; gone: string[] }> {
    const out: MessageInput[] = [];
    const gone: string[] = [];
    let queue = [...ids];
    let round = 0;
    while (queue.length > 0) {
      const retry: string[] = [];
      const chunks: string[][] = [];
      for (let i = 0; i < queue.length; i += BATCH_SIZE) chunks.push(queue.slice(i, i + BATCH_SIZE));
      // A few batches in flight at once; the limiter keeps us within quota.
      await Promise.all(
        chunks.map(async (chunk) => {
          const res = await this.batchGet(chunk, priority);
          for (const id of chunk) {
            const r = res.get(id);
            if (r?.status === 200) out.push(toMessageInput(JSON.parse(r.body) as RawMessage));
            else if (r?.status === 404) gone.push(id);
            else retry.push(id);
          }
        }),
      );
      if (retry.length === 0) break;
      if (++round > 5) throw new GmailError(429, `Gave up fetching ${retry.length} messages`);
      const wait = Math.min(16_000, 1000 * 2 ** round);
      this.limiter.penalize(wait);
      await sleep(wait);
      queue = retry;
    }
    return { messages: out, gone };
  }

  private async batchGet(ids: string[], priority: Priority) {
    await this.limiter.acquire(UNITS.get * ids.length, priority);
    const boundary = `batch_${crypto.randomUUID()}`;
    const body =
      ids
        .map(
          (id) =>
            `--${boundary}\r\nContent-Type: application/http\r\nContent-ID: <${id}>\r\n\r\n` +
            `GET /gmail/v1/users/me/messages/${encodeURIComponent(id)}?${META_QUERY}\r\n\r\n`,
        )
        .join("") + `--${boundary}--`;

    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.token();
      const res = await fetch(BATCH_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": `multipart/mixed; boundary=${boundary}` },
        body,
      });
      if (res.status === 401 && attempt === 0) {
        this.auth.invalidate();
        continue;
      }
      if (!res.ok) {
        if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
          await sleep(1000 * 2 ** attempt);
          continue;
        }
        throw new GmailError(res.status, `batch -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      const respBoundary = res.headers.get("content-type")?.match(/boundary=("?)([^";]+)\1/)?.[2];
      if (!respBoundary) throw new GmailError(500, "batch response without boundary");
      return parseBatchResponse(await res.text(), respBoundary);
    }
  }
}
