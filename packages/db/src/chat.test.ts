import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMailStore } from "./index.ts";
import type { ChatSpace, ChatMessage } from "@mailfast/shared";

describe("chat store", () => {
  test("upgrades an existing chat database without losing messages or conversations", () => {
    const directory = mkdtempSync(join(tmpdir(), "mailfast-chat-avatar-"));
    const path = join(directory, "legacy.sqlite");
    let store = openMailStore({ path });
    try {
      store.saveChatSpace({ id: "spaces/legacy", name: "Legacy", type: "DIRECT_MESSAGE", unreadCount: 1 });
      store.saveChatMessage({
        id: "spaces/legacy/messages/1",
        spaceId: "spaces/legacy",
        sender: { name: "users/alice", displayName: "Alice" },
        createTime: 1000,
        text: "Saved message",
      });
      store.sqlite.exec("ALTER TABLE chat_spaces DROP COLUMN avatar_url");
      store.close();
      store = openMailStore({ path });
      expect(store.listChatMessages("spaces/legacy")[0]?.text).toBe("Saved message");
      const space = store.getChatSpace("spaces/legacy");
      expect(space?.unreadCount).toBe(1);
      if (!space) throw new Error("Existing conversation was lost");
      store.upsertChatSpaces([{ ...space, avatarUrl: "https://photos.example.com/alice" }]);
      expect(store.getChatSpace(space.id)?.avatarUrl).toBe("https://photos.example.com/alice");
    } finally {
      store.close();
      for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
      rmdirSync(directory);
    }
  });

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
      avatarUrl: "https://photos.example.com/alice",
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
    expect(list[0].avatarUrl).toBe(space2.avatarUrl);
    expect(store.getChatSpace(space2.id)?.avatarUrl).toBe(space2.avatarUrl);
    store.upsertChatSpaces([{ ...space2, avatarUrl: "https://photos.example.com/updated" }]);
    expect(store.getChatSpace(space2.id)?.avatarUrl).toBe("https://photos.example.com/updated");
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
