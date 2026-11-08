import type { MailStore } from "@mailfast/db";
import {
  createSpaceSchema,
  sendChatMessageSchema,
  type ChatMessage,
  type ChatSpace,
  type CreateSpaceRequest,
} from "@mailfast/shared";
import type { Events } from "@/events.ts";

const CHAT_API_BASE = "https://chat.googleapis.com/v1";

export class GoogleChatClient {
  constructor(private readonly getToken: () => Promise<string>) {}

  private async fetch(endpoint: string, init?: RequestInit): Promise<Response> {
    const token = await this.getToken();
    return fetch(`${CHAT_API_BASE}${endpoint}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  }

  async listSpaces(): Promise<ChatSpace[]> {
    const res = await this.fetch("/spaces?pageSize=100");
    if (!res.ok) {
      throw new Error(`Google Chat API error: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      spaces?: Array<{
        name: string;
        displayName?: string;
        spaceType?: string;
        type?: string;
        spaceUri?: string;
        singleUserBotDm?: boolean;
      }>;
    };
    return (data.spaces ?? []).map((s) => ({
      id: s.name,
      name: s.displayName || (s.spaceType === "DIRECT_MESSAGE" ? "Direct Message" : s.name.replace("spaces/", "Space ")),
      type: s.spaceType === "DIRECT_MESSAGE" ? "DIRECT_MESSAGE" : s.spaceType === "GROUP_CHAT" ? "GROUP_CHAT" : "SPACE",
      singleUserBotDm: s.singleUserBotDm,
      spaceUri: s.spaceUri,
      unreadCount: 0,
    }));
  }

  async listMessages(spaceId: string, pageSize = 100): Promise<ChatMessage[]> {
    const cleanSpace = spaceId.startsWith("spaces/") ? spaceId : `spaces/${spaceId}`;
    const res = await this.fetch(`/${cleanSpace}/messages?pageSize=${pageSize}`);
    if (!res.ok) {
      throw new Error(`Google Chat API error: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      messages?: Array<{
        name: string;
        space?: { name: string };
        sender?: { name: string; displayName?: string; avatarUrl?: string; email?: string; type?: string };
        createTime?: string;
        text?: string;
        formattedText?: string;
        thread?: { name: string };
      }>;
    };
    return (data.messages ?? []).map((m) => ({
      id: m.name,
      spaceId: m.space?.name ?? cleanSpace,
      sender: {
        name: m.sender?.name ?? "users/unknown",
        displayName: m.sender?.displayName ?? (m.sender?.email ? m.sender.email.split("@")[0] : "User"),
        avatarUrl: m.sender?.avatarUrl,
        email: m.sender?.email,
      },
      createTime: m.createTime ? new Date(m.createTime).getTime() : Date.now(),
      text: m.text || m.formattedText || "",
      formattedText: m.formattedText,
      threadId: m.thread?.name,
    }));
  }

  async createMessage(spaceId: string, text: string, threadId?: string): Promise<ChatMessage> {
    const cleanSpace = spaceId.startsWith("spaces/") ? spaceId : `spaces/${spaceId}`;
    const body: Record<string, unknown> = { text };
    if (threadId) {
      body.thread = { name: threadId };
    }
    const res = await this.fetch(`/${cleanSpace}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Google Chat API error: ${res.status} ${res.statusText}`);
    }
    const m = (await res.json()) as {
      name: string;
      space?: { name: string };
      sender?: { name: string; displayName?: string; avatarUrl?: string; email?: string };
      createTime?: string;
      text?: string;
      formattedText?: string;
      thread?: { name: string };
    };
    return {
      id: m.name,
      spaceId: m.space?.name ?? cleanSpace,
      sender: {
        name: m.sender?.name ?? "users/me",
        displayName: m.sender?.displayName ?? "Me",
        avatarUrl: m.sender?.avatarUrl,
        email: m.sender?.email,
      },
      createTime: m.createTime ? new Date(m.createTime).getTime() : Date.now(),
      text: m.text ?? text,
      formattedText: m.formattedText,
      threadId: m.thread?.name ?? threadId,
    };
  }

  async createSpace(req: CreateSpaceRequest): Promise<ChatSpace> {
    const res = await this.fetch("/spaces", {
      method: "POST",
      body: JSON.stringify({
        spaceType: req.spaceType === "DIRECT_MESSAGE" ? "DIRECT_MESSAGE" : "SPACE",
        displayName: req.displayName,
      }),
    });
    if (!res.ok) {
      throw new Error(`Google Chat API error: ${res.status} ${res.statusText}`);
    }
    const s = (await res.json()) as {
      name: string;
      displayName?: string;
      spaceType?: string;
      spaceUri?: string;
    };
    return {
      id: s.name,
      name: s.displayName || req.displayName,
      type: s.spaceType === "DIRECT_MESSAGE" ? "DIRECT_MESSAGE" : "SPACE",
      spaceUri: s.spaceUri,
      unreadCount: 0,
    };
  }
}

export interface ChatRequestContext {
  store: MailStore;
  events: Events;
  token?: () => Promise<string>;
  accountEmail?: string | null;
  accountName?: string | null;
}

const SEED_SPACE_ID = "spaces/welcome";

function ensureSeedData(store: MailStore, currentUserEmail: string | null) {
  const existing = store.listChatSpaces();
  if (existing.length === 0) {
    const welcomeSpace: ChatSpace = {
      id: SEED_SPACE_ID,
      name: "Welcome to Google Chat",
      type: "SPACE",
      unreadCount: 0,
      lastMessageTime: Date.now(),
      lastMessageSnippet: "Welcome to Google Chat in Mailfast!",
    };
    store.saveChatSpace(welcomeSpace);
    store.saveChatMessage({
      id: `${SEED_SPACE_ID}/messages/welcome-1`,
      spaceId: SEED_SPACE_ID,
      sender: {
        name: "users/mailfast-bot",
        displayName: "Google Chat Assistant",
      },
      createTime: Date.now() - 60_000,
      text: "Welcome to Google Chat inside Mailfast! You can chat with teammates, organize discussions in Spaces, or send Direct Messages.",
    });
    store.saveChatMessage({
      id: `${SEED_SPACE_ID}/messages/welcome-2`,
      spaceId: SEED_SPACE_ID,
      sender: {
        name: "users/mailfast-bot",
        displayName: "Google Chat Assistant",
      },
      createTime: Date.now(),
      text: "Type a message below to try sending a message, or click the '+' button to start a new chat.",
    });
  }
}

export async function handleChatRequest(req: Request, ctx: ChatRequestContext): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/chat/")) return null;

  const path = url.pathname.slice("/api/chat/".length);
  const client = ctx.token ? new GoogleChatClient(ctx.token) : null;
  ensureSeedData(ctx.store, ctx.accountEmail ?? null);

  // GET /api/chat/spaces
  if (path === "spaces" && req.method === "GET") {
    if (client) {
      try {
        const liveSpaces = await client.listSpaces();
        if (liveSpaces.length > 0) {
          ctx.store.upsertChatSpaces(liveSpaces);
        }
      } catch (err) {
        // Chat API disabled or insufficient scope: gracefully fall back to local store
      }
    }
    const spaces = ctx.store.listChatSpaces();
    return Response.json({ spaces });
  }

  // POST /api/chat/spaces
  if (path === "spaces" && req.method === "POST") {
    const parsed = createSpaceSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid space request" }, { status: 400 });
    }

    let created: ChatSpace;
    if (client) {
      try {
        created = await client.createSpace(parsed.data);
      } catch {
        // Fall back to local space creation
        created = {
          id: `spaces/local-${crypto.randomUUID()}`,
          name: parsed.data.displayName,
          type: parsed.data.spaceType === "DIRECT_MESSAGE" ? "DIRECT_MESSAGE" : "SPACE",
          unreadCount: 0,
        };
      }
    } else {
      created = {
        id: `spaces/local-${crypto.randomUUID()}`,
        name: parsed.data.displayName,
        type: parsed.data.spaceType === "DIRECT_MESSAGE" ? "DIRECT_MESSAGE" : "SPACE",
        unreadCount: 0,
      };
    }

    ctx.store.saveChatSpace(created);
    ctx.events.send({ type: "chat-spaces-changed" });
    return Response.json(created);
  }

  // GET /api/chat/messages?spaceId=...
  if (path === "messages" && req.method === "GET") {
    const spaceId = url.searchParams.get("spaceId");
    if (!spaceId) {
      return Response.json({ error: "spaceId is required" }, { status: 400 });
    }

    if (client && !spaceId.startsWith("spaces/local-") && spaceId !== SEED_SPACE_ID) {
      try {
        const liveMsgs = await client.listMessages(spaceId);
        if (liveMsgs.length > 0) {
          ctx.store.upsertChatMessages(liveMsgs);
        }
      } catch {
        // Use cached messages
      }
    }

    const messages = ctx.store.listChatMessages(spaceId);
    return Response.json({ messages });
  }

  // POST /api/chat/messages
  if (path === "messages" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as { spaceId?: string; text?: string; threadId?: string } | null;
    const spaceId = body?.spaceId;
    if (!spaceId) {
      return Response.json({ error: "spaceId is required" }, { status: 400 });
    }

    const parsed = sendChatMessageSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid message" }, { status: 400 });
    }

    let sent: ChatMessage;
    if (client && !spaceId.startsWith("spaces/local-") && spaceId !== SEED_SPACE_ID) {
      try {
        sent = await client.createMessage(spaceId, parsed.data.text, parsed.data.threadId);
      } catch {
        sent = {
          id: `${spaceId}/messages/local-${crypto.randomUUID()}`,
          spaceId,
          sender: {
            name: "users/me",
            displayName: ctx.accountName || "Me",
            email: ctx.accountEmail ?? undefined,
            isSelf: true,
          },
          createTime: Date.now(),
          text: parsed.data.text,
          threadId: parsed.data.threadId,
        };
      }
    } else {
      sent = {
        id: `${spaceId}/messages/local-${crypto.randomUUID()}`,
        spaceId,
        sender: {
          name: "users/me",
          displayName: ctx.accountName || "Me",
          email: ctx.accountEmail ?? undefined,
          isSelf: true,
        },
        createTime: Date.now(),
        text: parsed.data.text,
        threadId: parsed.data.threadId,
      };
    }

    ctx.store.saveChatMessage(sent);
    ctx.events.send({ type: "chat-messages-changed", spaceId });
    return Response.json(sent);
  }

  // POST /api/chat/spaces/read
  if (path === "spaces/read" && req.method === "POST") {
    const body = (await req.json().catch(() => null)) as { spaceId?: string } | null;
    if (!body?.spaceId) {
      return Response.json({ error: "spaceId is required" }, { status: 400 });
    }
    ctx.store.markChatSpaceRead(body.spaceId);
    ctx.events.send({ type: "chat-spaces-changed" });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Not found" }, { status: 404 });
}
