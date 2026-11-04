import { describe, expect, test } from "bun:test";
import { openMailStore, toFtsQuery, ALL_MAIL, type MessageInput } from "./index.ts";

const msg = (o: Partial<MessageInput> & { id: string; threadId: string; date: number }): MessageInput => ({
  fromName: "Alice",
  fromEmail: "alice@example.com",
  to: "me@example.com",
  cc: "",
  subject: "Quarterly report",
  snippet: "numbers attached",
  labelIds: ["INBOX", "UNREAD"],
  ...o,
});

describe("mail store", () => {
  test("derives threads, label pages, search and optimistic modify", () => {
    const s = openMailStore({ path: ":memory:" });
    const changed = s.upsertMessages(
      [
        msg({ id: "m1", threadId: "t1", date: 100 }),
        msg({ id: "m2", threadId: "t1", date: 200, fromName: "Me", fromEmail: "me@example.com", labelIds: ["SENT"] }),
        msg({ id: "m3", threadId: "t2", date: 150, subject: "Lunch?", snippet: "pizza", labelIds: ["INBOX"] }),
      ],
      "me@example.com",
    );
    expect([...changed].sort()).toEqual([ALL_MAIL, "INBOX", "SENT", "UNREAD"].sort());

    const inbox = s.listThreads("INBOX", Number.MAX_SAFE_INTEGER, 50);
    expect(inbox.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(inbox[0]!.messageCount).toBe(2);
    expect(inbox[0]!.unread).toBe(true);
    expect(inbox[0]!.senders.map((p) => p.name)).toEqual(["Alice", "me"]);
    expect(s.listThreads("INBOX", 200, 50).map((t) => t.id)).toEqual(["t2"]);

    expect(s.searchThreads("quart", 10).map((t) => t.id)).toEqual(["t1"]);
    expect(s.searchThreads("pizz", 10).map((t) => t.id)).toEqual(["t2"]);

    s.modifyThreadLabels("t1", [], ["INBOX", "UNREAD"], "me@example.com");
    expect(s.listThreads("INBOX", Number.MAX_SAFE_INTEGER, 50).map((t) => t.id)).toEqual(["t2"]);
    expect(s.getThread("t1")!.thread.unread).toBe(false);

    s.deleteMessages(["m3"], null);
    expect(s.getThread("t2")).toBeNull();
    expect(s.searchThreads("pizza", 10)).toEqual([]);
    expect(s.missingMessages(["m1", "m3", "zz"])).toEqual(["m3", "zz"]);

    s.outboxAdd("t1", { kind: "archive" });
    expect(s.outboxActionsFor("t1")).toEqual([{ kind: "archive" }]);
    expect(s.messageCount()).toBe(2);
    expect(s.outboxCount()).toBe(1);
    s.close();
  });

  test("fts query escaping", () => {
    expect(toFtsQuery(' foo "bar ')).toBe('"foo"* "bar"*');
    expect(toFtsQuery("   ")).toBeNull();
  });
});
