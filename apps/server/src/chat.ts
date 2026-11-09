import type { MailStore } from "@mailfast/db";
import {
  createSpaceSchema,
  sendChatMessageSchema,
  type ChatApiStatus,
  type ChatMessage,
  type ChatSpace,
  type CreateSpaceRequest,
  type ListChatSpacesResponse,
} from "@mailfast/shared";
import type { Events } from "@/events.ts";

const CHAT_API_BASE = "https://chat.googleapis.com/v1";

export class GoogleChatClient {
  constructor(
    private readonly getToken: () => Promise<string>,
    private readonly myName?: string | null,
    private readonly myEmail?: string | null,
  ) {}

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
      const errText = await res.text().catch(() => "");
      throw new Error(`Google Chat API error: ${res.status} ${res.statusText} - ${errText}`);
    }
    const data = (await res.json()) as {
      spaces?: Array<{
        name: string;
        displayName?: string;
        spaceType?: string;
        type?: string;
        spaceUri?: string;
        singleUserBotDm?: boolean;
        lastActiveTime?: string;
      }>;
    };
    const spaces: ChatSpace[] = (data.spaces ?? []).map((s) => ({
      id: s.name,
      name:
        s.displayName ||
        (s.spaceType === "DIRECT_MESSAGE" ? "Direct Message" : s.name.replace("spaces/", "Space ")),
      type: (s.spaceType === "DIRECT_MESSAGE"
        ? "DIRECT_MESSAGE"
        : s.spaceType === "GROUP_CHAT"
          ? "GROUP_CHAT"
          : "SPACE") as ChatSpace["type"],
      singleUserBotDm: s.singleUserBotDm,
      spaceUri: s.spaceUri,
      unreadCount: 0,
      lastMessageTime: s.lastActiveTime ? new Date(s.lastActiveTime).getTime() : undefined,
    }));

    const myNameNorm = (this.myName ?? "").toLowerCase().trim();
    const myEmailNorm = (this.myEmail ?? "").toLowerCase().trim();

    // For DIRECT_MESSAGE spaces, resolve the other member's display name
    for (const space of spaces) {
      if (
        space.type === "DIRECT_MESSAGE" &&
        (!space.name || space.name === "Direct Message" || (myNameNorm && space.name.toLowerCase().trim() === myNameNorm))
      ) {
        try {
          const membersRes = await this.fetch(`/${space.id}/members?pageSize=10`);
          if (membersRes.ok) {
            const mData = (await membersRes.json()) as {
              memberships?: Array<{
                member?: {
                  name?: string;
                  displayName?: string;
                  type?: string;
                  avatarUrl?: string;
                  email?: string;
                };
              }>;
            };
            const memberships = mData.memberships ?? [];
            const other = memberships.find((m) => {
              const dName = (m.member?.displayName ?? "").toLowerCase().trim();
              const email = (m.member?.email ?? "").toLowerCase().trim();
              if (myEmailNorm && email && email === myEmailNorm) return false;
              if (myNameNorm && dName && (dName === myNameNorm || dName.startsWith(myNameNorm))) return false;
              return Boolean(m.member?.displayName || m.member?.email);
            }) ?? memberships.find((m) => {
              const dName = (m.member?.displayName ?? "").toLowerCase().trim();
              return dName !== "you" && dName !== "me" && dName !== myNameNorm;
            }) ?? memberships[1] ?? memberships[0];

            if (other?.member?.displayName) {
              const otherName = other.member.displayName;
              if (myNameNorm && otherName.toLowerCase().trim() === myNameNorm && memberships.length === 1) {
                space.name = `${otherName} (You)`;
              } else {
                space.name = otherName;
              }
              if (other.member.avatarUrl) {
                space.avatarUrl = other.member.avatarUrl;
              }
            } else if (other?.member?.email) {
              space.name = other.member.email.split("@")[0]!;
            }
          }
        } catch {
          // ignore member fetch error
        }
      }
    }

    // Sort spaces by lastMessageTime descending
    spaces.sort((a, b) => (b.lastMessageTime ?? 0) - (a.lastMessageTime ?? 0));

    // Fetch latest message snippet for the top active spaces
    const activeTop = spaces.slice(0, 15);
    await Promise.allSettled(
      activeTop.map(async (sp) => {
        try {
          const mRes = await this.fetch(`/${sp.id}/messages?pageSize=1&orderBy=createTime%20desc`);
          if (mRes.ok) {
            const mData = (await mRes.json()) as {
              messages?: Array<{
                text?: string;
                formattedText?: string;
                sender?: { displayName?: string; email?: string };
              }>;
            };
            const firstMsg = mData.messages?.[0];
            if (firstMsg) {
              const text = (firstMsg.text || firstMsg.formattedText || "").trim();
              if (text) {
                const sName = firstMsg.sender?.displayName;
                const isMsgSelf =
                  (myEmailNorm && firstMsg.sender?.email?.toLowerCase().trim() === myEmailNorm) ||
                  (myNameNorm && sName?.toLowerCase().trim() === myNameNorm);
                const prefix = isMsgSelf ? "You: " : sName && sp.type === "SPACE" ? `${sName}: ` : "";
                sp.lastMessageSnippet = `${prefix}${text}`;
              }
            }
          }
        } catch {
          // ignore snippet error
        }
      }),
    );

    return spaces;
  }

  async listMessages(spaceId: string, pageSize = 100): Promise<ChatMessage[]> {
    const cleanSpace = spaceId.startsWith("spaces/") ? spaceId : `spaces/${spaceId}`;
    const res = await this.fetch(`/${cleanSpace}/messages?pageSize=${pageSize}&orderBy=createTime%20desc`);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Google Chat API error: ${res.status} ${res.statusText} - ${errText}`);
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
    const myNameNorm = (this.myName ?? "").toLowerCase().trim();
    const myEmailNorm = (this.myEmail ?? "").toLowerCase().trim();

    const msgs = (data.messages ?? []).map((m) => {
      const senderName = (m.sender?.displayName ?? "").toLowerCase().trim();
      const senderEmail = (m.sender?.email ?? "").toLowerCase().trim();
      const isSelf =
        (myEmailNorm && senderEmail === myEmailNorm) ||
        (myNameNorm && (senderName === myNameNorm || senderName.startsWith(myNameNorm))) ||
        m.sender?.name === "users/me" ||
        senderName === "you" ||
        senderName === "me";

      return {
        id: m.name,
        spaceId: m.space?.name ?? cleanSpace,
        sender: {
          name: m.sender?.name ?? "users/unknown",
          displayName: isSelf ? "You" : (m.sender?.displayName ?? (m.sender?.email ? m.sender.email.split("@")[0]! : "User")),
          avatarUrl: m.sender?.avatarUrl,
          email: m.sender?.email,
          isSelf: Boolean(isSelf),
        },
        createTime: m.createTime ? new Date(m.createTime).getTime() : Date.now(),
        text: m.text || m.formattedText || "",
        formattedText: m.formattedText,
        threadId: m.thread?.name,
      };
    });

    // Sort ascending for chronological display from top to bottom
    msgs.sort((a, b) => a.createTime - b.createTime);
    return msgs;
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
      const errText = await res.text().catch(() => "");
      throw new Error(`Google Chat API error: ${res.status} ${res.statusText} - ${errText}`);
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
        displayName: m.sender?.displayName ?? "You",
        avatarUrl: m.sender?.avatarUrl,
        email: m.sender?.email,
        isSelf: true,
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
      const errText = await res.text().catch(() => "");
      throw new Error(`Google Chat API error: ${res.status} ${res.statusText} - ${errText}`);
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

const INITIAL_CHAT_SPACES: ChatSpace[] = [
  {
    id: "spaces/dm-arafat-ulla",
    name: "Arafat ulla",
    type: "DIRECT_MESSAGE",
    unreadCount: 0,
    lastMessageTime: new Date("2025-10-14T10:00:00Z").getTime(),
    lastMessageSnippet: "https://learnverse-gamified-platform.lovable.app/ https://schoolspark-engin...",
  },
  {
    id: "spaces/space-ainxt-site",
    name: "ainxt site",
    type: "SPACE",
    unreadCount: 0,
    lastMessageTime: new Date("2025-04-18T14:30:00Z").getTime(),
    lastMessageSnippet: "Aryan gilder: okay sir when its done i will send you via email",
  },
  {
    id: "spaces/space-web-dashboard",
    name: "web dashboard",
    type: "SPACE",
    unreadCount: 0,
    lastMessageTime: new Date("2025-03-05T09:15:00Z").getTime(),
    lastMessageSnippet: "hemant agaarwal: yes",
  },
  {
    id: "spaces/dm-hemant-agaarwal",
    name: "hemant agaarwal",
    type: "DIRECT_MESSAGE",
    unreadCount: 0,
    lastMessageTime: new Date("2025-02-20T11:45:00Z").getTime(),
    lastMessageSnippet: "see email by manish",
  },
  {
    id: "spaces/dm-nikhil-thakur",
    name: "Nikhil Thakur",
    type: "DIRECT_MESSAGE",
    unreadCount: 0,
    lastMessageTime: new Date("2025-01-22T16:20:00Z").getTime(),
    lastMessageSnippet: "take pull from there",
  },
  {
    id: "spaces/dm-prakruti-dangi",
    name: "Prakruti Dangi",
    type: "DIRECT_MESSAGE",
    unreadCount: 0,
    lastMessageTime: new Date("2025-01-18T13:10:00Z").getTime(),
    lastMessageSnippet: "You: https://meet.google.com/ndm-mxac-ffj",
  },
  {
    id: "spaces/dm-pulak-jain",
    name: "pulak jain",
    type: "DIRECT_MESSAGE",
    unreadCount: 0,
    lastMessageTime: new Date("2025-01-12T15:05:00Z").getTime(),
    lastMessageSnippet: "sry to abhi woh api ke payload se wo remove kerdoge to wo api work kerne la...",
  },
  {
    id: "spaces/dm-niranjan-kumar",
    name: "Niranjan Kumar",
    type: "DIRECT_MESSAGE",
    unreadCount: 0,
    lastMessageTime: new Date("2025-01-08T18:40:00Z").getTime(),
    lastMessageSnippet: "Okay",
  },
  {
    id: "spaces/space-alumniapp-new",
    name: "alumniapp -new",
    type: "SPACE",
    unreadCount: 0,
    lastMessageTime: new Date("2024-12-10T12:00:00Z").getTime(),
    lastMessageSnippet: "Discussion for alumniapp release and deployment",
  },
];

const INITIAL_CHAT_MESSAGES: ChatMessage[] = [
  // Arafat ulla
  {
    id: "spaces/dm-arafat-ulla/messages/1",
    spaceId: "spaces/dm-arafat-ulla",
    sender: { name: "users/arafat-ulla", displayName: "Arafat ulla" },
    createTime: new Date("2025-10-14T10:00:00Z").getTime(),
    text: "https://learnverse-gamified-platform.lovable.app/ https://schoolspark-engine.lovable.app/",
  },
  // ainxt site
  {
    id: "spaces/space-ainxt-site/messages/1",
    spaceId: "spaces/space-ainxt-site",
    sender: { name: "users/me", displayName: "You", isSelf: true },
    createTime: new Date("2024-12-15T10:00:00Z").getTime(),
    text: "@Kapil Kumar updated the ui in new branch",
  },
  {
    id: "spaces/space-ainxt-site/messages/2",
    spaceId: "spaces/space-ainxt-site",
    sender: { name: "users/nikhil-thakur", displayName: "Nikhil Thakur" },
    createTime: new Date("2024-12-15T10:05:00Z").getTime(),
    text: "ok",
  },
  {
    id: "spaces/space-ainxt-site/messages/3",
    spaceId: "spaces/space-ainxt-site",
    sender: { name: "users/me", displayName: "You", isSelf: true },
    createTime: new Date("2024-12-16T11:20:00Z").getTime(),
    text: "Working on it",
  },
  {
    id: "spaces/space-ainxt-site/messages/4",
    spaceId: "spaces/space-ainxt-site",
    sender: { name: "users/nikhil-thakur", displayName: "Nikhil Thakur" },
    createTime: new Date("2024-12-16T11:25:00Z").getTime(),
    text: "ok",
  },
  {
    id: "spaces/space-ainxt-site/messages/5",
    spaceId: "spaces/space-ainxt-site",
    sender: { name: "users/me", displayName: "You", isSelf: true },
    createTime: new Date("2025-02-10T14:00:00Z").getTime(),
    text: "This will be implemented after customer dasboard APIs are stable",
  },
  {
    id: "spaces/space-ainxt-site/messages/6",
    spaceId: "spaces/space-ainxt-site",
    sender: { name: "users/nikhil-thakur", displayName: "Nikhil Thakur" },
    createTime: new Date("2025-02-10T14:02:00Z").getTime(),
    text: "also reply them on email for this,",
  },
  {
    id: "spaces/space-ainxt-site/messages/7",
    spaceId: "spaces/space-ainxt-site",
    sender: { name: "users/aryan-gilder", displayName: "Aryan gilder" },
    createTime: new Date("2025-04-18T14:30:00Z").getTime(),
    text: "okay sir when its done i will send you via email",
  },
  // web dashboard
  {
    id: "spaces/space-web-dashboard/messages/1",
    spaceId: "spaces/space-web-dashboard",
    sender: { name: "users/dev-28", displayName: "dev 28" },
    createTime: new Date("2025-01-20T09:30:00Z").getTime(),
    text: "ok",
  },
  {
    id: "spaces/space-web-dashboard/messages/2",
    spaceId: "spaces/space-web-dashboard",
    sender: { name: "users/me", displayName: "You", isSelf: true },
    createTime: new Date("2025-01-20T09:32:00Z").getTime(),
    text: "Joining",
  },
  {
    id: "spaces/space-web-dashboard/messages/3",
    spaceId: "spaces/space-web-dashboard",
    sender: { name: "users/hemant-agaarwal", displayName: "hemant agaarwal" },
    createTime: new Date("2025-03-05T09:15:00Z").getTime(),
    text: "yes",
  },
  // hemant agaarwal
  {
    id: "spaces/dm-hemant-agaarwal/messages/1",
    spaceId: "spaces/dm-hemant-agaarwal",
    sender: { name: "users/hemant-agaarwal", displayName: "hemant agaarwal" },
    createTime: new Date("2025-02-20T11:45:00Z").getTime(),
    text: "see email by manish",
  },
  // Nikhil Thakur
  {
    id: "spaces/dm-nikhil-thakur/messages/1",
    spaceId: "spaces/dm-nikhil-thakur",
    sender: { name: "users/nikhil-thakur", displayName: "Nikhil Thakur" },
    createTime: new Date("2025-01-22T16:20:00Z").getTime(),
    text: "take pull from there",
  },
  // Prakruti Dangi
  {
    id: "spaces/dm-prakruti-dangi/messages/1",
    spaceId: "spaces/dm-prakruti-dangi",
    sender: { name: "users/me", displayName: "You", isSelf: true },
    createTime: new Date("2025-01-18T13:10:00Z").getTime(),
    text: "https://meet.google.com/ndm-mxac-ffj",
  },
  // pulak jain
  {
    id: "spaces/dm-pulak-jain/messages/1",
    spaceId: "spaces/dm-pulak-jain",
    sender: { name: "users/pulak-jain", displayName: "pulak jain" },
    createTime: new Date("2025-01-12T15:05:00Z").getTime(),
    text: "sry to abhi woh api ke payload se wo remove kerdoge to wo api work kerne la...",
  },
  // Niranjan Kumar
  {
    id: "spaces/dm-niranjan-kumar/messages/1",
    spaceId: "spaces/dm-niranjan-kumar",
    sender: { name: "users/niranjan-kumar", displayName: "Niranjan Kumar" },
    createTime: new Date("2025-01-08T18:40:00Z").getTime(),
    text: "Okay",
  },
  // alumniapp -new
  {
    id: "spaces/space-alumniapp-new/messages/1",
    spaceId: "spaces/space-alumniapp-new",
    sender: { name: "users/me", displayName: "You", isSelf: true },
    createTime: new Date("2024-12-10T12:00:00Z").getTime(),
    text: "Discussion for alumniapp release and deployment",
  },
];

function ensureSeedData(store: MailStore, currentUserEmail: string | null) {
  const existing = store.listChatSpaces();
  const hasOnlyPlaceholder = existing.length === 1 && existing[0]?.id === SEED_SPACE_ID;
  if (existing.length === 0 || hasOnlyPlaceholder) {
    if (hasOnlyPlaceholder) {
      store.deleteChatSpace(SEED_SPACE_ID);
    }
    for (const space of INITIAL_CHAT_SPACES) {
      store.saveChatSpace(space);
    }
    for (const msg of INITIAL_CHAT_MESSAGES) {
      store.saveChatMessage(msg);
    }
  }
}

export async function handleChatRequest(req: Request, ctx: ChatRequestContext): Promise<Response | null> {
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/api/chat/")) return null;

  const path = url.pathname.slice("/api/chat/".length);
  const client = ctx.token ? new GoogleChatClient(ctx.token, ctx.accountName, ctx.accountEmail) : null;
  if (!client) {
    ensureSeedData(ctx.store, ctx.accountEmail ?? null);
  }

  // GET /api/chat/spaces
  if (path === "spaces" && req.method === "GET") {
    let apiStatus: ChatApiStatus = { connected: true };
    if (client) {
      try {
        const liveSpaces = await client.listSpaces();
        if (liveSpaces.length > 0) {
          // Remove mock seed spaces so only genuine account data displays
          for (const seedSpace of INITIAL_CHAT_SPACES) {
            ctx.store.deleteChatSpace(seedSpace.id);
          }
          ctx.store.deleteChatSpace(SEED_SPACE_ID);
          ctx.store.upsertChatSpaces(liveSpaces);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isServiceDisabled =
          msg.includes("SERVICE_DISABLED") ||
          msg.includes("has not been used in project") ||
          msg.includes("or it is disabled");
        const activationMatch = msg.match(
          /https:\/\/console\.developers\.google\.com\/apis\/api\/chat\.googleapis\.com\/overview\?project=\d+/,
        );
        apiStatus = {
          connected: false,
          disabled: isServiceDisabled,
          activationUrl: activationMatch
            ? activationMatch[0]
            : "https://console.developers.google.com/apis/api/chat.googleapis.com/overview",
          message: isServiceDisabled
            ? "Google Chat API is not enabled in your Google Cloud Console project. Enable it to sync live conversations."
            : msg,
        };
      }
    } else {
      apiStatus = { connected: false, message: "No Google account configured" };
    }
    const spaces = ctx.store.listChatSpaces();
    return Response.json({ spaces, apiStatus } satisfies ListChatSpacesResponse);
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

    if (client && !spaceId.startsWith("spaces/local-") && !spaceId.startsWith("spaces/dm-") && !spaceId.startsWith("spaces/space-")) {
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
    if (client && !spaceId.startsWith("spaces/local-") && !spaceId.startsWith("spaces/dm-") && !spaceId.startsWith("spaces/space-")) {
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
