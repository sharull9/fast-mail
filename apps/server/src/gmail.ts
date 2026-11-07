import type { MessageInput } from "@mailfast/db";
import type { AttachmentMeta, Label, SendMessageRequest, SendMessageResponse } from "@mailfast/shared";
import type { Auth } from "@/auth.ts";
import { Limiter, Priority } from "@/limiter.ts";

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
const UNITS = {
  get: 5,
  list: 5,
  threadGet: 10,
  history: 2,
  labels: 1,
  labelGet: 1,
  modify: 10,
  trash: 10,
  profile: 1,
  send: 100,
};

export class GmailError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface RawPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: RawPart[];
}

export interface RawMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: RawPart;
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

function decodeBase64Url(data: string): string {
  try {
    return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  } catch {
    return "";
  }
}

export function extractBodyAndAttachments(payload?: RawPart): {
  bodyHtml: string | null;
  bodyText: string | null;
  attachments: AttachmentMeta[];
} {
  if (!payload) {
    return { bodyHtml: null, bodyText: null, attachments: [] };
  }

  const isFullPayload = Boolean(payload.body?.data || (payload.parts && payload.parts.length > 0));
  if (!isFullPayload) {
    return { bodyHtml: null, bodyText: null, attachments: [] };
  }

  let bodyHtml: string | null = null;
  let bodyText: string | null = null;
  const attachments: AttachmentMeta[] = [];

  function traverse(part: RawPart) {
    const mimeType = (part.mimeType ?? "").toLowerCase();
    const filename = (part.filename ?? "").trim();
    const attachmentId = part.body?.attachmentId;
    const isAttachment = Boolean(filename || attachmentId);

    if (isAttachment) {
      attachments.push({
        id: attachmentId,
        filename: filename || "attachment",
        mimeType: mimeType || "application/octet-stream",
        size: part.body?.size ?? 0,
      });
      return;
    }

    if (mimeType === "text/html" && part.body?.data) {
      const decoded = decodeBase64Url(part.body.data);
      if (decoded) {
        bodyHtml = bodyHtml ? `${bodyHtml}<br/>${decoded}` : decoded;
      }
    } else if (mimeType === "text/plain" && part.body?.data) {
      const decoded = decodeBase64Url(part.body.data);
      if (decoded) {
        bodyText = bodyText ? `${bodyText}\n${decoded}` : decoded;
      }
    }

    if (part.parts && Array.isArray(part.parts)) {
      for (const child of part.parts) {
        traverse(child);
      }
    }
  }

  traverse(payload);

  if (bodyHtml === null && bodyText === null) {
    bodyText = "";
  }

  return { bodyHtml, bodyText, attachments };
}

export function toMessageInput(raw: RawMessage): MessageInput {
  const headers = new Map<string, string>();
  for (const h of raw.payload?.headers ?? []) {
    const key = h.name.toLowerCase();
    if (!headers.has(key)) headers.set(key, h.value);
  }
  const from = parseAddress(headers.get("from") ?? "");
  const extracted = extractBodyAndAttachments(raw.payload);
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
    bodyHtml: extracted.bodyHtml,
    bodyText: extracted.bodyText,
    attachments: extracted.attachments.length > 0 ? extracted.attachments : undefined,
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

  constructor(private readonly auth: Pick<Auth, "token" | "invalidate">) {}

  private async request<T>(
    path: string,
    opts: { method?: string; query?: string; body?: unknown; units: number; priority: Priority; retry?: boolean },
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
      if (retryable && opts.retry !== false && attempt < 6) {
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
    opts: { labelId?: string; pageToken?: string; maxResults: number; includeSpamTrash?: boolean; q?: string },
    priority: Priority,
  ) {
    const p = new URLSearchParams({
      maxResults: String(opts.maxResults),
      fields: "messages(id,threadId),nextPageToken",
    });
    if (opts.labelId) p.set("labelIds", opts.labelId);
    if (opts.pageToken) p.set("pageToken", opts.pageToken);
    if (opts.q) p.set("q", opts.q);
    if (opts.includeSpamTrash) p.set("includeSpamTrash", "true");
    return this.request<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>("/messages", {
      query: p.toString(),
      units: UNITS.list,
      priority,
    });
  }

  async thread(threadId: string, priority: Priority): Promise<MessageInput[]> {
    const res = await this.request<{ messages?: RawMessage[] }>(`/threads/${encodeURIComponent(threadId)}`, {
      query: "format=full",
      units: UNITS.threadGet,
      priority,
    });
    return (res.messages ?? []).map(toMessageInput);
  }

  rawMessage(id: string) {
    return this.request<{ raw: string }>(`/messages/${encodeURIComponent(id)}`, {
      query: "format=raw&fields=raw",
      units: UNITS.get,
      priority: Priority.Interactive,
    });
  }

  importMessage(raw: string) {
    return this.request<{ id: string; threadId: string }>("/messages/import", {
      method: "POST",
      query: "internalDateSource=dateHeader",
      body: { raw },
      units: 25,
      priority: Priority.Interactive,
      // A retry after an ambiguous server failure could create a duplicate.
      retry: false,
    });
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

  getAttachment(
    messageId: string,
    attachmentId: string,
    priority = Priority.Interactive,
  ): Promise<{ size: number; data: string }> {
    return this.request<{ size: number; data: string }>(
      `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
      { units: UNITS.get, priority },
    );
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
   * Sends an email message through Gmail API (POST /messages/send).
   */
  async sendMessage(opts: SendMessageRequest): Promise<SendMessageResponse> {
    const mime = buildMimeMessage(opts);
    const raw = Buffer.from(mime, "utf-8").toString("base64url");
    return this.request<SendMessageResponse>("/messages/send", {
      method: "POST",
      body: { raw, threadId: opts.threadId || undefined },
      units: UNITS.send,
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

export function chunkBase64(str: string): string {
  return str.match(/.{1,76}/g)?.join("\r\n") || str;
}

export function htmlToPlainText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/p>|<br\s*\/?>|<li>|<\/div>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

export function buildMimeMessage(opts: SendMessageRequest): string {
  const boundaryMixed = `mixed_${crypto.randomUUID()}`;
  const boundaryAlt = `alt_${crypto.randomUUID()}`;

  const encodeHeaderWord = (str: string) => {
    if (/[\x80-\xFF\r\n]/.test(str)) {
      return `=?UTF-8?B?${Buffer.from(str, "utf-8").toString("base64")}?=`;
    }
    return str;
  };

  const headers: string[] = [
    `MIME-Version: 1.0`,
    `Date: ${new Date().toUTCString()}`,
    `Subject: ${encodeHeaderWord(opts.subject)}`,
  ];

  if (opts.to && opts.to.length > 0) {
    headers.push(`To: ${opts.to.join(", ")}`);
  }
  if (opts.cc && opts.cc.length > 0) {
    headers.push(`Cc: ${opts.cc.join(", ")}`);
  }
  if (opts.bcc && opts.bcc.length > 0) {
    headers.push(`Bcc: ${opts.bcc.join(", ")}`);
  }
  if (opts.inReplyTo) {
    headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  }
  if (opts.references) {
    headers.push(`References: ${opts.references}`);
  }

  const plainText = opts.bodyText ?? htmlToPlainText(opts.bodyHtml);
  const plainBase64 = Buffer.from(plainText, "utf-8").toString("base64");
  const htmlBase64 = Buffer.from(opts.bodyHtml, "utf-8").toString("base64");

  const hasAttachments = opts.attachments && opts.attachments.length > 0;

  if (hasAttachments) {
    headers.push(`Content-Type: multipart/mixed; boundary="${boundaryMixed}"`);
    const parts: string[] = [
      headers.join("\r\n"),
      "",
      `--${boundaryMixed}`,
      `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
      "",
      `--${boundaryAlt}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      "",
      chunkBase64(plainBase64),
      "",
      `--${boundaryAlt}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      "",
      chunkBase64(htmlBase64),
      "",
      `--${boundaryAlt}--`,
    ];

    for (const att of opts.attachments!) {
      const cleanData = att.content.replace(/^data:.*?;base64,/, "");
      const safeFilename = att.filename.replace(/["\r\n]/g, "_");
      parts.push(
        `--${boundaryMixed}`,
        `Content-Type: ${att.mimeType || "application/octet-stream"}; name="${safeFilename}"`,
        `Content-Disposition: attachment; filename="${safeFilename}"`,
        `Content-Transfer-Encoding: base64`,
        "",
        chunkBase64(cleanData),
      );
    }
    parts.push(`--${boundaryMixed}--`, "");
    return parts.join("\r\n");
  } else {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundaryAlt}"`);
    const parts: string[] = [
      headers.join("\r\n"),
      "",
      `--${boundaryAlt}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      "",
      chunkBase64(plainBase64),
      "",
      `--${boundaryAlt}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      "",
      chunkBase64(htmlBase64),
      "",
      `--${boundaryAlt}--`,
      "",
    ];
    return parts.join("\r\n");
  }
}
