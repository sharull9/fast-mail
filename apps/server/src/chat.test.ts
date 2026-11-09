import { describe, expect, test } from "bun:test";
import { openMailStore } from "@mailfast/db";
import { Events } from "./events.ts";
import { handleChatRequest } from "./chat.ts";
import type { ServerEvent } from "@mailfast/shared";

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
});
