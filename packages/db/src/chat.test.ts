import { describe, expect, test } from "bun:test";
import { openMailStore } from "./index.ts";
import type { ChatSpace, ChatMessage } from "@mailfast/shared";

describe("chat store", () => {
  test("creates, lists, and reads chat spaces", () => {
    const store = openMailStore({ path: ":memory:" });
    expect(store.listChatSpaces()).toEqual([]);

    const space1: ChatSpace = {
      id: "spaces/space1",
      name: "Engineering",
      type: "SPACE",
      unreadCount: 2,
      lastMessageTime: 1000,
      lastMessageSnippet: "Hello team",
    };
    const space2: ChatSpace = {
      id: "spaces/space2",
      name: "Alice Smith",
      type: "DIRECT_MESSAGE",
      unreadCount: 0,
      lastMessageTime: 2000,
      lastMessageSnippet: "Sounds good!",
    };

    store.saveChatSpace(space1);
    store.saveChatSpace(space2);

    const list = store.listChatSpaces();
    expect(list.length).toBe(2);
    // Ordered by lastMessageTime DESC
    expect(list[0].id).toBe("spaces/space2");
    expect(list[1].id).toBe("spaces/space1");

    expect(store.getChatSpace("spaces/space1")?.name).toBe("Engineering");

    store.markChatSpaceRead("spaces/space1");
    expect(store.getChatSpace("spaces/space1")?.unreadCount).toBe(0);

    store.deleteChatSpace("spaces/space1");
    expect(store.listChatSpaces().length).toBe(1);

    store.close();
  });

  test("saves and lists chat messages ordered by time", () => {
    const store = openMailStore({ path: ":memory:" });
    const spaceId = "spaces/dev";
    store.saveChatSpace({
      id: spaceId,
      name: "Developers",
      type: "SPACE",
      unreadCount: 0,
    });

    const msg1: ChatMessage = {
      id: "spaces/dev/messages/1",
      spaceId,
      sender: {
        name: "users/u1",
        displayName: "Bob",
        email: "bob@example.com",
      },
      createTime: 5000,
      text: "First message",
    };

    const msg2: ChatMessage = {
      id: "spaces/dev/messages/2",
      spaceId,
      sender: {
        name: "users/u2",
        displayName: "Alice",
        email: "alice@example.com",
      },
      createTime: 6000,
      text: "Second message",
    };

    store.saveChatMessage(msg1);
    store.saveChatMessage(msg2);

    const messages = store.listChatMessages(spaceId);
    expect(messages.length).toBe(2);
    expect(messages[0].text).toBe("First message");
    expect(messages[1].text).toBe("Second message");

    // Space's last message time & snippet should be updated automatically
    const space = store.getChatSpace(spaceId);
    expect(space?.lastMessageTime).toBe(6000);
    expect(space?.lastMessageSnippet).toBe("Second message");

    store.close();
  });
});
