import { describe, expect, spyOn, test } from "bun:test";
import { openMailStore } from "@mailfast/db";
import { Events } from "@/events.ts";
import { GoogleChatClient, handleChatRequest } from "@/chat.ts";
import type { ServerEvent } from "@mailfast/shared";

describe("chat request handling", () => {
  test.each(["DIRECT_MESSAGE", "GROUP_CHAT"] as const)("rejects thread replies in %s conversations", async (type) => {
    const store = openMailStore({ path: ":memory:" });
    const emitted: ServerEvent[] = [];
    const events = new Events("test-account", (event) => emitted.push(event));
    store.saveChatSpace({ id: "spaces/test", name: "Conversation", type, unreadCount: 0 });
    try {
      const response = await handleChatRequest(
        new Request("http://localhost/api/chat/messages", {
          method: "POST",
          body: JSON.stringify({ spaceId: "spaces/test", text: "Reply", threadId: "spaces/test/threads/root" }),
        }),
        { store, events },
      );
      expect(response?.status).toBe(400);
      expect(await response?.json()).toEqual({ error: "Thread replies are only available in spaces." });
      expect(store.listChatMessages("spaces/test")).toEqual([]);
      expect(emitted).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("allows a thread reply in a space", async () => {
    const store = openMailStore({ path: ":memory:" });
    store.saveChatSpace({ id: "spaces/test", name: "Team", type: "SPACE", unreadCount: 0 });
    try {
      const response = await handleChatRequest(
        new Request("http://localhost/api/chat/messages", {
          method: "POST",
          body: JSON.stringify({ spaceId: "spaces/test", text: "Reply", threadId: "spaces/test/threads/root" }),
        }),
        { store, events: new Events() },
      );
      expect(response?.status).toBe(200);
      expect(store.listChatMessages("spaces/test")[0]?.threadId).toBe("spaces/test/threads/root");
    } finally {
      store.close();
    }
  });

  test("creates a real Meet link using the Google account token", async () => {
    const store = openMailStore({ path: ":memory:" });
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        meetingUri: "https://meet.google.com/abc-defg-hij",
      }),
    );
    try {
      const response = await handleChatRequest(new Request("http://localhost/api/chat/meet", { method: "POST" }), {
        store,
        events: new Events(),
        token: async () => "google-token",
      });
      expect(response?.status).toBe(200);
      expect(await response?.json()).toEqual({ meetingUri: "https://meet.google.com/abc-defg-hij" });
      expect(fetchMock).toHaveBeenCalledWith("https://meet.googleapis.com/v2/spaces", {
        method: "POST",
        headers: { Authorization: "Bearer google-token", "Content-Type": "application/json" },
        body: "{}",
      });
      expect(store.listChatSpaces()).toEqual([]);
    } finally {
      fetchMock.mockRestore();
      store.close();
    }
  });

  test.each([
    { status: 403, body: {}, message: "reconnecting" },
    { status: 500, body: {}, message: "Try again" },
    { status: 200, body: { meetingUri: "https://example.com/fake" }, message: "valid meeting link" },
    { status: 200, body: {}, message: "valid meeting link" },
  ])("reports Meet failures without inventing a link: %j", async ({ status, body, message }) => {
    const store = openMailStore({ path: ":memory:" });
    const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(body, { status }));
    try {
      const response = await handleChatRequest(new Request("http://localhost/api/chat/meet", { method: "POST" }), {
        store,
        events: new Events(),
        token: async () => "google-token",
      });
      expect(response?.status).toBe(502);
      expect(await response?.text()).toContain(message);
    } finally {
      fetchMock.mockRestore();
      store.close();
    }
  });

  test("requires a connected Google account to create a Meet link", async () => {
    const store = openMailStore({ path: ":memory:" });
    try {
      const response = await handleChatRequest(new Request("http://localhost/api/chat/meet", { method: "POST" }), {
        store,
        events: new Events(),
      });
      expect(response?.status).toBe(409);
      expect(await response?.text()).toContain("Connect a Google account");
    } finally {
      store.close();
    }
  });

  test("lists spaces including seeded welcome space", async () => {
    const store = openMailStore({ path: ":memory:" });
    const events = new Events();
    const req = new Request("http://localhost/api/chat/spaces", { method: "GET" });

    const res = await handleChatRequest(req, {
      store,
      events,
      accountEmail: "test@example.com",
      accountName: "Tester",
    });

    expect(res).not.toBeNull();
    expect(res?.status).toBe(200);
    const data = (await res?.json()) as { spaces: Array<{ id: string; name: string }> };
    expect(data.spaces.length).toBeGreaterThanOrEqual(1);
    expect(data.spaces.some((s) => s.id === "spaces/space-ainxt-site")).toBe(true);
    expect(data.spaces.some((s) => s.id === "spaces/dm-arafat-ulla")).toBe(true);

    store.close();
  });

  test("creates a new space and emits event", async () => {
    const store = openMailStore({ path: ":memory:" });
    const emitted: ServerEvent[] = [];
    const events = new Events("test-account", (ev) => emitted.push(ev));

    const req = new Request("http://localhost/api/chat/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Team Alpha", spaceType: "SPACE" }),
    });

    const res = await handleChatRequest(req, {
      store,
      events,
      accountEmail: "test@example.com",
      accountName: "Tester",
    });

    expect(res?.status).toBe(200);
    const created = (await res?.json()) as { id: string; name: string; type: string };
    expect(created.name).toBe("Team Alpha");
    expect(created.type).toBe("SPACE");
    expect(emitted.some((e) => e.type === "chat-spaces-changed")).toBe(true);

    // Verify it is in the store
    const spaces = store.listChatSpaces();
    expect(spaces.some((s) => s.name === "Team Alpha")).toBe(true);

    store.close();
  });

  test("sends message to a space and retrieves messages", async () => {
    const store = openMailStore({ path: ":memory:" });
    const emitted: ServerEvent[] = [];
    const events = new Events("test-account", (ev) => emitted.push(ev));

    // Create space
    store.saveChatSpace({
      id: "spaces/project",
      name: "Project Chat",
      type: "SPACE",
      unreadCount: 0,
    });

    // Send message
    const sendReq = new Request("http://localhost/api/chat/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        spaceId: "spaces/project",
        text: "Hello everyone!",
      }),
    });

    const sendRes = await handleChatRequest(sendReq, {
      store,
      events,
      accountEmail: "alice@example.com",
      accountName: "Alice",
    });

    expect(sendRes?.status).toBe(200);
    const sentMsg = (await sendRes?.json()) as { id: string; text: string; sender: { displayName: string } };
    expect(sentMsg.text).toBe("Hello everyone!");
    expect(sentMsg.sender.displayName).toBe("Alice");
    expect(emitted.some((e) => e.type === "chat-messages-changed")).toBe(true);

    // Get messages
    const getReq = new Request("http://localhost/api/chat/messages?spaceId=spaces/project", {
      method: "GET",
    });

    const getRes = await handleChatRequest(getReq, {
      store,
      events,
      accountEmail: "alice@example.com",
      accountName: "Alice",
    });

    expect(getRes?.status).toBe(200);
    const data = (await getRes?.json()) as { messages: Array<{ text: string }> };
    expect(data.messages.length).toBe(1);
    expect(data.messages[0].text).toBe("Hello everyone!");

    store.close();
  });

  test("marks space as read", async () => {
    const store = openMailStore({ path: ":memory:" });
    const events = new Events();

    store.saveChatSpace({
      id: "spaces/unread-test",
      name: "Unread Space",
      type: "SPACE",
      unreadCount: 5,
    });

    const req = new Request("http://localhost/api/chat/spaces/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ spaceId: "spaces/unread-test" }),
    });

    const res = await handleChatRequest(req, { store, events });
    expect(res?.status).toBe(200);
    expect(store.getChatSpace("spaces/unread-test")?.unreadCount).toBe(0);

    store.close();
  });

  test("GoogleChatClient resolves DM other participant and parses lastActiveTime", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (url: string | URL | Request) => {
        const u = url instanceof Request ? url.url : url.toString();
        if (u.includes("/spaces?pageSize=100")) {
          return new Response(
            JSON.stringify({
              spaces: [
                {
                  name: "spaces/dm123",
                  spaceType: "DIRECT_MESSAGE",
                  lastActiveTime: "2026-02-15T12:00:00Z",
                },
                {
                  name: "spaces/space-accounting",
                  displayName: "Accounting",
                  spaceType: "SPACE",
                  lastActiveTime: "2026-02-14T10:00:00Z",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (u.includes("/spaces/dm123/members")) {
          return new Response(
            JSON.stringify({
              memberships: [
                {
                  member: {
                    name: "users/me-id",
                    displayName: "Arafat ulla",
                    email: "arafat@infoware.ws",
                    type: "HUMAN",
                  },
                },
                {
                  member: {
                    name: "users/other-id",
                    displayName: "hemant agaarwal",
                    email: "hemant@infoware.ws",
                    type: "HUMAN",
                  },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (u.includes("/messages?pageSize=1")) {
          return new Response(
            JSON.stringify({
              messages: [
                {
                  text: "pls share tasks",
                  sender: { displayName: "hemant agaarwal", email: "hemant@infoware.ws" },
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response("{}", { status: 200 });
      }) as typeof fetch;

      const client = new GoogleChatClient(async () => "fake-token", "Arafat ulla", "arafat@infoware.ws");

      const spaces = await client.listSpaces();
      expect(spaces.length).toBe(2);

      const dm = spaces.find((s) => s.id === "spaces/dm123");
      expect(dm?.name).toBe("hemant agaarwal");
      expect(dm?.lastMessageTime).toBe(new Date("2026-02-15T12:00:00Z").getTime());

      const space = spaces.find((s) => s.id === "spaces/space-accounting");
      expect(space?.name).toBe("Accounting");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("GoogleChatClient flags isSelf on messages matching user", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (_url: string | URL | Request) => {
        return new Response(
          JSON.stringify({
            messages: [
              {
                name: "spaces/dm123/messages/1",
                sender: { displayName: "Arafat ulla", email: "arafat@infoware.ws" },
                text: "Sharing",
                createTime: "2026-02-15T12:05:00Z",
              },
              {
                name: "spaces/dm123/messages/2",
                sender: { displayName: "hemant agaarwal", email: "hemant@infoware.ws" },
                text: "shared",
                createTime: "2026-02-15T12:06:00Z",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch;

      const client = new GoogleChatClient(async () => "fake-token", "Arafat ulla", "arafat@infoware.ws");

      const msgs = await client.listMessages("spaces/dm123");
      expect(msgs.length).toBe(2);
      expect(msgs[0].sender.isSelf).toBe(true);
      expect(msgs[0].sender.displayName).toBe("You");
      expect(msgs[1].sender.isSelf).toBe(false);
      expect(msgs[1].sender.displayName).toBe("hemant agaarwal");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
