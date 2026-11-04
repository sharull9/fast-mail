// Types shared by the Bun server (apps/server) and the web UI (apps/web).
// Message bodies are deliberately out of scope: everything here is metadata.

export const AUTH_HEADER = "x-mailfast-token";

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
  backfillDone: boolean;
  lastSyncAt: number | null;
  pendingActions: number;
  error: string | null;
}

export interface AuthStatus {
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
export type ServerEvent =
  | { type: "status"; status: SyncStatus }
  | { type: "threads-changed"; labelIds: string[] }
  | { type: "labels-changed" }
  | { type: "thread-updated"; threadId: string };

export interface ListThreadsResponse {
  threads: ThreadRow[];
  hasMore: boolean;
}
