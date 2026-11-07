import { afterEach, expect, mock, test } from "bun:test";
import { openMailStore, type MessageInput } from "@mailfast/db";
import type { AuthStatus } from "@mailfast/shared";
import { Events } from "@/events.ts";
import { Gmail } from "@/gmail.ts";
import { SyncEngine } from "@/sync.ts";

const stores: ReturnType<typeof openMailStore>[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function fixture() {
  const store = openMailStore({ path: ":memory:" });
  stores.push(store);
  return store;
}

test("sendMessage calls Gmail API and syncs thread into store", async () => {
  const store = fixture();
  const gmail = new Gmail({ token: async () => "test", invalidate() {} });
  const events = new Events();
  const authStatus: AuthStatus = {
    accounts: [],
    activeAccountId: null,
    configured: true,
    signedIn: true,
    account: "me@example.com",
  };
  const sync = new SyncEngine(store, gmail, { status: () => authStatus, account: () => "me@example.com" }, events);

  // Mock sendMessage
  gmail.sendMessage = mock(async (_opts) => {
    return { id: "sent-msg-1", threadId: "sent-thread-1", labelIds: ["SENT"] };
  });

  // Mock thread fetch for sync.ensureThread
  const threadMsg: MessageInput = {
    id: "sent-msg-1",
    threadId: "sent-thread-1",
    date: Date.now(),
    fromName: "Me",
    fromEmail: "me@example.com",
    to: "alice@example.com",
    cc: "",
    subject: "Hello Alice",
    snippet: "Hello Alice",
    labelIds: ["SENT"],
    bodyHtml: "<p>Hello Alice</p>",
    bodyText: "Hello Alice",
  };
  gmail.thread = mock(async () => [threadMsg]);

  // Execute sendMessage
  const sent = await gmail.sendMessage({
    to: ["alice@example.com"],
    subject: "Hello Alice",
    bodyHtml: "<p>Hello Alice</p>",
  });

  expect(sent.id).toBe("sent-msg-1");
  expect(sent.threadId).toBe("sent-thread-1");

  // Sync the thread
  await sync.ensureThread(sent.threadId, true);

  // Verify message is in local store
  const thread = store.getThread("sent-thread-1");
  expect(thread).toBeDefined();
  expect(thread?.thread.subject).toBe("Hello Alice");
  expect(store.hasMessage("sent-msg-1")).toBe(true);
});
