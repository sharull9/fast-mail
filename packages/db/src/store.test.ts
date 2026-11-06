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

  test("sender filters search local sender fields and combine with text", () => {
    const s = openMailStore({ path: ":memory:" });
    try {
      s.upsertMessages(
        [
          msg({ id: "m1", threadId: "t1", date: 1, subject: "Invoice", fromName: "Alice Cooper" }),
          msg({
            id: "m2",
            threadId: "t2",
            date: 2,
            subject: "Alice invoice",
            fromName: "Bob",
            fromEmail: "bob@example.com",
          }),
          msg({ id: "m3", threadId: "t3", date: 3, subject: "Lunch", fromName: "Alice Cooper" }),
          msg({
            id: "m4",
            threadId: "t4",
            date: 4,
            subject: "Fwd",
            fromName: "Carol",
            fromEmail: "carol@x.com",
            to: "alice@example.com, me@example.com",
          }),
        ],
        null,
      );
      expect(s.searchThreads("@user:alice", 10).map((t) => t.id)).toEqual(["t3", "t1"]);
      expect(s.searchThreads("@user:carol", 10).map((t) => t.id)).toEqual(["t4"]);
      expect(s.searchThreads("@user:alice invoice", 10).map((t) => t.id)).toEqual(["t1"]);
      expect(s.searchThreads('@user:"Alice Cooper" invoice', 10).map((t) => t.id)).toEqual(["t1"]);
      expect(s.searchThreads("@user:bob@example.com", 10).map((t) => t.id)).toEqual(["t2"]);
      expect(s.searchThreads("@user:nobody", 10)).toEqual([]);
      expect(s.searchThreads("@user:", 10)).toEqual([]);
      expect(s.searchThreads("", 10)).toEqual([]);
    } finally {
      s.close();
    }
  });

  test("inbox categories exclude archived mail and filter before pagination", () => {
    const s = openMailStore({ path: ":memory:" });
    try {
      s.upsertMessages(
        [
          msg({ id: "a", threadId: "a", date: 1 }),
          msg({ id: "b", threadId: "b", date: 2, labelIds: ["INBOX", "CATEGORY_PERSONAL"] }),
          msg({ id: "c", threadId: "c", date: 3, labelIds: ["INBOX", "CATEGORY_SOCIAL"] }),
          msg({ id: "d", threadId: "d", date: 4, labelIds: ["CATEGORY_SOCIAL"] }),
          msg({ id: "e", threadId: "e", date: 5, labelIds: ["INBOX", "CATEGORY_UPDATES"] }),
          msg({ id: "f", threadId: "f", date: 6, labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }),
        ],
        null,
      );
      expect(s.listThreads("INBOX_PRIMARY", 100, 1).map((t) => t.id)).toEqual(["b"]);
      expect(s.listThreads("INBOX_PRIMARY", 2, 10).map((t) => t.id)).toEqual(["a"]);
      expect(s.listThreads("INBOX_SOCIAL", 100, 10).map((t) => t.id)).toEqual(["c"]);
      expect(s.listThreads("INBOX_UPDATES", 100, 10).map((t) => t.id)).toEqual(["e"]);
      s.modifyThreadLabels("c", [], ["INBOX"], null);
      expect(s.listThreads("INBOX_SOCIAL", 100, 10)).toEqual([]);
    } finally {
      s.close();
    }
  });
});
