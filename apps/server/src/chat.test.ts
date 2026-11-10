import { describe, expect, setSystemTime, test } from "bun:test";
import { openMailStore } from "@mailfast/db";
import { Events } from "@/events.ts";
import { GoogleChatClient, MESSAGES_TTL_MS, SPACES_TTL_MS, handleChatRequest } from "@/chat.ts";
import type { ChatSpace, ServerEvent } from "@mailfast/shared";

/** A fetch stub that records every URL so tests can assert on API call counts. */
function countingFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { fn, calls, count: (needle: string) => calls.filter((url) => url.includes(needle)).length };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** Lets background (non-awaited) refreshes finish without depending on wall-clock time. */
async function flushUntil(check: () => boolean, attempts = 200) {
  for (let i = 0; i < attempts && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("chat request handling", () => {
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
        const u = url.toString();
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
      globalThis.fetch = (async (url: string | URL | Request) => {
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

  test("a second spaces request is served from cache without calling Google again", async () => {
    const originalFetch = globalThis.fetch;
    const store = openMailStore({ path: ":memory:" });
    const events = new Events();
    try {
      const mock = countingFetch((url) => {
        if (url.includes("/spaces?pageSize=100")) {
          return json({
            spaces: [
              {
                name: "spaces/space-cached",
                displayName: "Cached Space",
                spaceType: "SPACE",
                lastActiveTime: "2026-02-15T12:00:00Z",
              },
            ],
          });
        }
        // Snippet lookups return nothing, keeping the stub focused on the spaces call.
        return json({});
      });
      globalThis.fetch = mock.fn;

      const ctx = {
        store,
        events,
        token: async () => "fake-token",
        accountEmail: "tester@example.com",
        accountName: "Tester",
      };

      const first = await handleChatRequest(new Request("http://localhost/api/chat/spaces", { method: "GET" }), ctx);
      expect(first?.status).toBe(200);
      const firstData = (await first?.json()) as { spaces: Array<{ id: string }>; apiStatus?: { connected: boolean } };
      expect(firstData.spaces.some((s) => s.id === "spaces/space-cached")).toBe(true);
      expect(firstData.apiStatus?.connected).toBe(true);
      expect(mock.count("/spaces?pageSize=100")).toBe(1);

      const second = await handleChatRequest(new Request("http://localhost/api/chat/spaces", { method: "GET" }), ctx);
      const secondData = (await second?.json()) as { spaces: Array<{ id: string }> };
      expect(secondData.spaces.some((s) => s.id === "spaces/space-cached")).toBe(true);
      // Fresh cache: the live list call is not repeated.
      expect(mock.count("/spaces?pageSize=100")).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      store.close();
    }
  });

  test("stale spaces are revalidated in the background and emit a change event", async () => {
    const originalFetch = globalThis.fetch;
    const store = openMailStore({ path: ":memory:" });
    const emitted: ServerEvent[] = [];
    const events = new Events("test-account", (ev) => emitted.push(ev));
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    try {
      let liveName = "Alpha";
      const mock = countingFetch((url) => {
        if (url.includes("/spaces?pageSize=100")) {
          return json({
            spaces: [
              {
                name: "spaces/space-revalidated",
                displayName: liveName,
                spaceType: "SPACE",
                lastActiveTime: "2026-02-15T12:00:00Z",
              },
            ],
          });
        }
        return json({});
      });
      globalThis.fetch = mock.fn;

      const ctx = {
        store,
        events,
        token: async () => "fake-token",
        accountEmail: "tester@example.com",
        accountName: "Tester",
      };

      setSystemTime(new Date(base));
      const first = await handleChatRequest(new Request("http://localhost/api/chat/spaces", { method: "GET" }), ctx);
      const firstData = (await first?.json()) as { spaces: Array<{ name: string }> };
      expect(firstData.spaces[0]?.name).toBe("Alpha");
      expect(mock.count("/spaces?pageSize=100")).toBe(1);

      // Age the snapshot past the TTL and change what Google would return.
      setSystemTime(new Date(base + SPACES_TTL_MS + 1_000));
      liveName = "Beta";
      const eventsBefore = emitted.length;

      const second = await handleChatRequest(new Request("http://localhost/api/chat/spaces", { method: "GET" }), ctx);
      const secondData = (await second?.json()) as { spaces: Array<{ name: string }> };
      // Stale-while-revalidate: the caller gets the cached snapshot immediately.
      expect(secondData.spaces[0]?.name).toBe("Alpha");
      expect(mock.count("/spaces?pageSize=100")).toBe(2);

      await flushUntil(() => store.listChatSpaces()[0]?.name === "Beta");
      expect(emitted.slice(eventsBefore).some((ev) => ev.type === "chat-spaces-changed")).toBe(true);
      expect(store.listChatSpaces()[0]?.name).toBe("Beta");
    } finally {
      setSystemTime();
      globalThis.fetch = originalFetch;
      store.close();
    }
  });

  test("a second messages request is served from cache without calling Google again", async () => {
    const originalFetch = globalThis.fetch;
    const store = openMailStore({ path: ":memory:" });
    const events = new Events();
    try {
      const mock = countingFetch((url) => {
        if (url.includes("/messages?pageSize=100")) {
          return json({
            messages: [
              {
                name: "spaces/abc123/messages/1",
                sender: { name: "users/other", displayName: "Other", email: "other@example.com" },
                text: "hello",
                createTime: "2026-02-15T12:05:00Z",
              },
            ],
          });
        }
        return json({});
      });
      globalThis.fetch = mock.fn;

      const ctx = {
        store,
        events,
        token: async () => "fake-token",
        accountEmail: "tester@example.com",
        accountName: "Tester",
      };
      const url = "http://localhost/api/chat/messages?spaceId=spaces/abc123";

      const first = await handleChatRequest(new Request(url, { method: "GET" }), ctx);
      const firstData = (await first?.json()) as { messages: Array<{ text: string }> };
      expect(firstData.messages.length).toBe(1);
      expect(mock.count("/messages?pageSize=100")).toBe(1);

      const second = await handleChatRequest(new Request(url, { method: "GET" }), ctx);
      const secondData = (await second?.json()) as { messages: Array<{ text: string }> };
      expect(secondData.messages[0]?.text).toBe("hello");
      expect(mock.count("/messages?pageSize=100")).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      store.close();
    }
  });

  test("stale messages revalidate in the background and only emit on change", async () => {
    const originalFetch = globalThis.fetch;
    const store = openMailStore({ path: ":memory:" });
    const emitted: ServerEvent[] = [];
    const events = new Events("test-account", (ev) => emitted.push(ev));
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    try {
      let text = "first";
      const mock = countingFetch((url) => {
        if (url.includes("/messages?pageSize=100")) {
          return json({
            messages: [
              {
                name: "spaces/abc123/messages/1",
                sender: { name: "users/other", displayName: "Other", email: "other@example.com" },
                text,
                createTime: "2026-02-15T12:05:00Z",
              },
            ],
          });
        }
        return json({});
      });
      globalThis.fetch = mock.fn;

      const ctx = {
        store,
        events,
        token: async () => "fake-token",
        accountEmail: "tester@example.com",
        accountName: "Tester",
      };
      const url = "http://localhost/api/chat/messages?spaceId=spaces/abc123";

      setSystemTime(new Date(base));
      await handleChatRequest(new Request(url, { method: "GET" }), ctx);
      expect(store.listChatMessages("spaces/abc123")[0]?.text).toBe("first");

      setSystemTime(new Date(base + MESSAGES_TTL_MS + 1_000));
      text = "second";
      const eventsBefore = emitted.length;
      const res = await handleChatRequest(new Request(url, { method: "GET" }), ctx);
      const data = (await res?.json()) as { messages: Array<{ text: string }> };
      expect(data.messages[0]?.text).toBe("first");

      await flushUntil(() => store.listChatMessages("spaces/abc123")[0]?.text === "second");
      expect(
        emitted.slice(eventsBefore).some((ev) => ev.type === "chat-messages-changed" && ev.spaceId === "spaces/abc123"),
      ).toBe(true);
      expect(store.listChatMessages("spaces/abc123")[0]?.text).toBe("second");
    } finally {
      setSystemTime();
      globalThis.fetch = originalFetch;
      store.close();
    }
  });

  test("GoogleChatClient reuses known names and snippets to skip extra API calls", async () => {
    const originalFetch = globalThis.fetch;
    try {
      const mock = countingFetch((url) => {
        if (url.includes("/spaces?pageSize=100")) {
          return json({
            spaces: [
              { name: "spaces/dm123", spaceType: "DIRECT_MESSAGE", lastActiveTime: "2026-02-15T12:00:00Z" },
              {
                name: "spaces/space-accounting",
                displayName: "Accounting",
                spaceType: "SPACE",
                lastActiveTime: "2026-02-14T10:00:00Z",
              },
            ],
          });
        }
        return json({});
      });
      globalThis.fetch = mock.fn;

      const known = new Map<string, ChatSpace>([
        [
          "spaces/dm123",
          {
            id: "spaces/dm123",
            name: "hemant agaarwal",
            type: "DIRECT_MESSAGE",
            unreadCount: 0,
            lastMessageTime: new Date("2026-02-15T12:00:00Z").getTime(),
            lastMessageSnippet: "pls share tasks",
          },
        ],
        [
          "spaces/space-accounting",
          {
            id: "spaces/space-accounting",
            name: "Accounting",
            type: "SPACE",
            unreadCount: 0,
            lastMessageTime: new Date("2026-02-14T10:00:00Z").getTime(),
            lastMessageSnippet: "invoices ready",
          },
        ],
      ]);

      const client = new GoogleChatClient(async () => "fake-token", "Arafat ulla", "arafat@infoware.ws");
      const spaces = await client.listSpaces(known);

      // Nothing changed since the last sync, so no members or snippet calls.
      expect(mock.count("/members")).toBe(0);
      expect(mock.count("/messages?pageSize=1")).toBe(0);

      const dm = spaces.find((s) => s.id === "spaces/dm123");
      expect(dm?.name).toBe("hemant agaarwal");
      expect(dm?.lastMessageSnippet).toBe("pls share tasks");

      const space = spaces.find((s) => s.id === "spaces/space-accounting");
      expect(space?.lastMessageSnippet).toBe("invoices ready");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
