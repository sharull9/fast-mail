// Types shared by the Bun server (apps/server) and the web UI (apps/web).
// Message bodies are deliberately out of scope: everything here is metadata.

export const AUTH_HEADER = "x-mailfast-token";

/** Public identity only: credentials and mailbox details never belong here. */
export interface ServerDescriptor {
  product: "mailfast";
  protocolVersion: 1;
  instanceId: string;
  mode: "desktop" | "standalone";
  origin: string;
}

export interface ConnectionStatus {
  server: ServerDescriptor;
  paired: boolean;
}

export interface PairingGrant {
  code: string;
  expiresAt: number;
  url: string;
}

/** Public metadata for a paired browser session; never includes the session token. */
export interface PairedBrowser {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  origin: string | null;
  userAgent: string | null;
  current?: boolean;
}

export const INBOX_TABS = [
  { id: "INBOX", name: "All" },
  { id: "INBOX_PRIMARY", name: "Primary" },
  { id: "INBOX_SOCIAL", name: "Social" },
  { id: "INBOX_UPDATES", name: "Updates" },
] as const;

export function isInboxCategory(id: string): boolean {
  return id !== "INBOX" && INBOX_TABS.some((tab) => tab.id === id);
}

/** Gmail category label that files an inbox thread under the Social or Updates tab. */
export function inboxCategoryLabel(id: string): string | null {
  if (id === "INBOX_SOCIAL") return "CATEGORY_SOCIAL";
  if (id === "INBOX_UPDATES") return "CATEGORY_UPDATES";
  return null;
}

/** Category labels that keep an inbox thread out of the Primary tab. */
export const NON_PRIMARY_CATEGORY_LABELS = [
  "CATEGORY_SOCIAL",
  "CATEGORY_UPDATES",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_FORUMS",
] as const;

export function belongsInMailbox(id: string, labels: string[]): boolean {
  if (id === "ALL") return !labels.includes("SPAM") && !labels.includes("TRASH");
  if (!isInboxCategory(id)) return labels.includes(id);
  if (!labels.includes("INBOX")) return false;
  if (id === "INBOX_PRIMARY") return !NON_PRIMARY_CATEGORY_LABELS.some((l) => labels.includes(l));
  return labels.includes(inboxCategoryLabel(id)!);
}

export interface Label {
  id: string;
  name: string;
  type: "system" | "user";
  color: string | null;
  /** Unread threads, as reported by Gmail. */
  unread: number;
  total: number;
}

export interface Participant {
  name: string;
  email: string;
}

/** One row of a mailbox list. Derived locally from message metadata. */
export interface ThreadRow {
  id: string;
  lastDate: number;
  subject: string;
  snippet: string;
  /** Distinct senders, oldest first. */
  senders: Participant[];
  messageCount: number;
  unread: boolean;
  starred: boolean;
  important: boolean;
  labelIds: string[];
}

export interface MessageMeta {
  id: string;
  threadId: string;
  date: number;
  from: Participant;
  to: string;
  cc: string;
  subject: string;
  snippet: string;
  labelIds: string[];
  unread: boolean;
  starred: boolean;
}

export interface ThreadDetail {
  thread: ThreadRow;
  messages: MessageMeta[];
  /** False while the server is still fetching older messages of this thread from Gmail. */
  complete: boolean;
}

export type SyncPhase = "signed-out" | "idle" | "initial" | "backfill" | "incremental" | "error";

export interface SyncStatus {
  phase: SyncPhase;
  account: string | null;
  messagesStored: number;
  oldestMessageDate: number | null;
  backfillDone: boolean;
  lastSyncAt: number | null;
  pendingActions: number;
  error: string | null;
}

export interface MailAccount {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  unread: number;
}

export interface AuthStatus {
  accounts: MailAccount[];
  activeAccountId: string | null;
  configured: boolean;
  signedIn: boolean;
  account: string | null;
}

export type ThreadAction =
  | { kind: "archive" }
  | { kind: "inbox" }
  | { kind: "trash" }
  | { kind: "untrash" }
  | { kind: "read" }
  | { kind: "unread" }
  | { kind: "star" }
  | { kind: "unstar" }
  | { kind: "important" }
  | { kind: "unimportant" };

/** Label deltas each action applies. Used by the server and for optimistic UI. */
export function actionDelta(action: ThreadAction): { add: string[]; remove: string[] } {
  switch (action.kind) {
    case "archive":
      return { add: [], remove: ["INBOX"] };
    case "inbox":
      return { add: ["INBOX"], remove: [] };
    case "trash":
      return { add: ["TRASH"], remove: ["INBOX"] };
    case "untrash":
      return { add: [], remove: ["TRASH"] };
    case "read":
      return { add: [], remove: ["UNREAD"] };
    case "unread":
      return { add: ["UNREAD"], remove: [] };
    case "star":
      return { add: ["STARRED"], remove: [] };
    case "unstar":
      return { add: [], remove: ["STARRED"] };
    case "important":
      return { add: ["IMPORTANT"], remove: [] };
    case "unimportant":
      return { add: [], remove: ["IMPORTANT"] };
  }
}

export function applyDelta(labelIds: string[], delta: { add: string[]; remove: string[] }): string[] {
  const set = new Set(labelIds);
  for (const l of delta.remove) set.delete(l);
  for (const l of delta.add) set.add(l);
  return [...set];
}

/** Server-sent events pushed on /api/events. */
export type ServerEventData =
  | { type: "status"; status: SyncStatus }
  | { type: "threads-changed"; labelIds: string[] }
  | { type: "labels-changed" }
  | { type: "thread-updated"; threadId: string }
  | { type: "accounts-changed" };

export type ServerEvent = ServerEventData & { accountId: string };

/** Epoch milliseconds: inclusive lower bound, exclusive upper bound. */
export interface ThreadDateRange {
  after?: number;
  before?: number;
}

export interface ListThreadsParams extends ThreadDateRange {
  label?: string;
  limit?: number;
}

export interface ListThreadsResponse {
  threads: ThreadRow[];
  hasMore: boolean;
  /** Number of cached threads in the requested range (before applying limit). */
  total?: number;
}
