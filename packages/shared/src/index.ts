// Types shared by the Bun server (apps/server) and the web UI (apps/web).
import { z } from "zod";

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

export interface AttachmentMeta {
  id?: string;
  filename: string;
  mimeType: string;
  size: number;
  contentId?: string;
  inline?: boolean;
}

export interface ThreadAttachment extends AttachmentMeta {
  messageId: string;
  fromName: string;
  date: number;
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
  bodyHtml?: string | null;
  bodyText?: string | null;
  attachments?: AttachmentMeta[];
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
  profileName?: string | null;
  signature?: string;
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

export const threadActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("archive") }),
  z.object({ kind: z.literal("inbox") }),
  z.object({ kind: z.literal("trash") }),
  z.object({ kind: z.literal("untrash") }),
  z.object({ kind: z.literal("read") }),
  z.object({ kind: z.literal("unread") }),
  z.object({ kind: z.literal("star") }),
  z.object({ kind: z.literal("unstar") }),
  z.object({ kind: z.literal("important") }),
  z.object({ kind: z.literal("unimportant") }),
]);

export type ThreadAction = z.infer<typeof threadActionSchema>;

export const threadActionsRequestSchema = z.object({
  threadIds: z.array(z.string()).min(1, "threadIds must not be empty"),
  action: threadActionSchema,
});
export type ThreadActionsRequest = z.infer<typeof threadActionsRequestSchema>;

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
  | { type: "accounts-changed" }
  | { type: "contacts-changed" }
  | { type: "account-settings-changed" }
  | { type: "chat-spaces-changed" }
  | { type: "chat-messages-changed"; spaceId: string };

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

export const sendMessageAttachmentSchema = z.object({
  filename: z.string().min(1, "Attachment filename is required"),
  mimeType: z.string().default("application/octet-stream"),
  content: z.string().min(1, "Attachment content is required"), // base64-encoded string
  size: z.number().optional(),
});
export type SendMessageAttachment = z.infer<typeof sendMessageAttachmentSchema>;

export const sendMessageRequestSchema = z.object({
  to: z.array(z.string().min(1)).min(1, "At least one recipient is required"),
  cc: z.array(z.string().min(1)).optional(),
  bcc: z.array(z.string().min(1)).optional(),
  subject: z.string().min(1, "Subject is required"),
  bodyHtml: z.string().default(""),
  bodyText: z.string().optional(),
  threadId: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.string().optional(),
  attachments: z.array(sendMessageAttachmentSchema).optional(),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const sendMessageResponseSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
});
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;

export const contactSchema = z.object({
  name: z.string(),
  email: z.string(),
});
export type Contact = z.infer<typeof contactSchema>;

export const mailExportRequestSchema = z.union([
  z.object({ messageId: z.string().min(1).max(256) }),
  z.object({ threadIds: z.array(z.string().min(1).max(256)).min(1).max(500) }),
]);
export type MailExportRequest = z.infer<typeof mailExportRequestSchema>;
export interface MailImportResult {
  imported: number;
  total: number;
  failed: { index: number; error: string }[];
}

export const accountSettingsSchema = z.object({
  displayName: z.string().trim().max(100),
  signature: z.string().max(10_000),
});
export type AccountSettings = z.infer<typeof accountSettingsSchema>;
export const contactEmailSchema = z.string().trim().toLowerCase().email().max(254);
export const saveContactSchema = z.object({
  email: contactEmailSchema,
  name: z.string().trim().max(200),
  originalEmail: contactEmailSchema.optional(),
});
export type SaveContact = z.infer<typeof saveContactSchema>;
export interface ManagedContact extends Contact {
  hidden: boolean;
}
export interface ContactPage {
  contacts: ManagedContact[];
  nextOffset: number | null;
}
export const contactVisibilitySchema = z.object({ email: contactEmailSchema, hidden: z.boolean() });
export const contactImportSchema = z.object({
  contacts: z.array(saveContactSchema.omit({ originalEmail: true })).max(100),
});
export const contactPageSchema = z.object({
  q: z.string().max(254).default(""),
  hidden: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const devicePreferencesSchema = z.object({
  version: z.literal(1),
  theme: z.enum(["light", "dark", "system"]),
  shortcuts: z.record(z.string(), z.unknown()),
});

// ------------------------------------------------------------------ Google Chat

export interface ChatSpace {
  id: string;
  name: string;
  type: "SPACE" | "GROUP_CHAT" | "DIRECT_MESSAGE";
  singleUserBotDm?: boolean;
  spaceUri?: string;
  unreadCount: number;
  lastMessageTime?: number;
  lastMessageSnippet?: string;
}

export interface ChatSender {
  name: string;
  displayName: string;
  avatarUrl?: string;
  email?: string;
  isSelf?: boolean;
}

export interface ChatMessage {
  id: string;
  spaceId: string;
  sender: ChatSender;
  createTime: number;
  text: string;
  formattedText?: string;
  threadId?: string;
}

export const sendChatMessageSchema = z.object({
  text: z.string().trim().min(1, "Message cannot be empty").max(4000),
  threadId: z.string().optional(),
});
export type SendChatMessageRequest = z.infer<typeof sendChatMessageSchema>;

export const createSpaceSchema = z.object({
  displayName: z.string().trim().min(1, "Name cannot be empty").max(100),
  spaceType: z.enum(["SPACE", "DIRECT_MESSAGE"]).default("SPACE"),
  email: z.string().email().optional(),
});
export type CreateSpaceRequest = z.infer<typeof createSpaceSchema>;

